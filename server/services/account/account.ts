import { getFirebaseAuth, getFirebaseDb } from '../../utils/firebaseAdmin'
import { forgetVerifiedUser } from '../../utils/session'
import { clearDeleting, markDeleting } from './tombstone'
import { deleteComposioConnection, isComposioConfigured, listComposioUserConnections } from '../composio/client'

/**
 * Everything OpenLobs holds about one person: what leaves in an export and what an account deletion
 * removes. Keeping both in one list means a new collection is added in one place.
 */

/**
 * `payments` is handled separately on erase: records are anonymised rather than deleted.
 */
/** Top-level collections where each document carries the owner's `userId`. */
const OWNED = ['chats', 'workflows', 'agents', 'memories', 'mcp_servers', 'usage', 'generated_files', 'integrations', 'notification_log', 'connector_credentials', 'connector_usage', 'connector_audit'] as const
/** Collections with one document per person, named by their id. */
const PER_PERSON = ['memory_settings', 'user_plans', 'user_settings'] as const
/** Nested data that goes with its parent document. */
const NESTED: Record<string, string[]> = { chats: ['messages', 'votes'], workflows: ['runs'] }

export const EXPORT_FORMAT = 1

const LEGACY_SECRETS = ['accessToken', 'refreshToken', 'token', 'apiKey', 'secret', 'credentials', 'sealed', 'sealedToken', 'password']
const SECRET_HEADER = /authorization|cookie|token|secret|key|password|signature/i

const URL_SECRET = /([?&;](?:[\w-]*(?:key|token|secret|password|passwd|sig|signature|auth|credential)[\w-]*|code)=)[^&\s"'<>#]+/gi

/** Replaces the value of any credential-looking query parameter inside text, keeping the rest of the address. */
function scrubUrlSecrets(value: any): any {
  if (typeof value === 'string') return value.replace(URL_SECRET, '$1[not exported]')
  if (Array.isArray(value)) return value.map(scrubUrlSecrets)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubUrlSecrets(v)]))
  return value
}

/** Workflow settings that act as passwords: the webhook secret and the value of any request header. Names stay so the flow is still readable. */
function redactWorkflow(workflow: any): any {
  const out = { ...workflow }
  delete out.webhookSecret
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => {
        if (/^headers?$/i.test(k) && v && typeof v === 'object') {
          return [k, Array.isArray(v) ? v.map((h: any) => (h && typeof h === 'object' ? { ...h, value: '[not exported]' } : h)) : Object.fromEntries(Object.keys(v as object).map(name => [name, '[not exported]']))]
        }
        if (SECRET_HEADER.test(k) && typeof v === 'string') return [k, '[not exported]']
        return [k, clean(v)]
      }))
    }
    return value
  }
  if (out.nodes) out.nodes = clean(out.nodes)
  // Addresses can carry a key in their query string, in the settings and in what each run recorded.
  return scrubUrlSecrets(out)
}

/** File names and sizes, read without the file contents (a select keeps the bytes out of memory). */
async function listedFiles(db: any, userId: string) {
  let query = db.collection('generated_files').where('userId', '==', userId)
  if (typeof query.select === 'function') query = query.select('name', 'mime', 'size', 'createdAt', 'expiresAt', 'userId')
  const snap = await query.get()
  return (snap.docs as any[]).map((doc) => {
    const data = plain(doc.data())
    delete data.data
    return { id: doc.id, ...data }
  })
}

export interface AccountDeps {
  db: any
  /** Ids of the person's connected apps (Composio). */
  listConnections: (userId: string) => Promise<Array<{ id: string }>>
  disconnect: (userId: string, connectionId: string) => Promise<boolean>
  deleteAuthUser: (userId: string) => Promise<void>
  /** Signs the person out everywhere: their existing sign-in tokens stop working. */
  revokeSessions?: (userId: string) => Promise<void>
}

export function defaultAccountDeps(): AccountDeps {
  return {
    db: getFirebaseDb(),
    listConnections: userId => (isComposioConfigured() ? listComposioUserConnections(userId) : Promise.resolve([])),
    disconnect: (userId, id) => deleteComposioConnection(userId, id, { ownershipVerified: true }),
    deleteAuthUser: userId => getFirebaseAuth().deleteUser(userId),
    revokeSessions: async (userId) => {
      await getFirebaseAuth().revokeRefreshTokens(userId)
      forgetVerifiedUser(userId)
    }
  }
}

/** Plain JSON: Firestore timestamps become ISO strings and binary data is left out. */
export function plain(value: any): any {
  if (value === null || value === undefined) return value ?? null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) || typeof value.toUint8Array === 'function') return '[binary data not included]'
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  return value
}

const ownedDocs = async (db: any, collection: string, userId: string) =>
  (await db.collection(collection).where('userId', '==', userId).get()).docs as any[]

export interface UserExport {
  format: number
  exportedAt: string
  account: { id: string, name: string, email: string | null }
  plan: unknown
  usage: unknown[]
  chats: unknown[]
  workflows: unknown[]
  agents: unknown[]
  memory: { enabled: boolean, items: unknown[] }
  mcpServers: unknown[]
  files: unknown[]
  payments: unknown[]
  notifications: unknown
  notificationLog: unknown[]
  legacyIntegrations: unknown[]
  connectedApps: string[]
  connectedKeys: unknown[]
  connectorActivity: unknown[]
}

/**
 * The person's data as one JSON document. Secrets are left out on purpose: MCP tokens are not
 * included (only that a server exists), and file contents are listed, not embedded.
 */
export async function collectUserData(deps: AccountDeps, user: { id: string, name: string, email?: string }, now = new Date()): Promise<UserExport> {
  const { db } = deps
  const id = user.id

  const withNested = async (collection: string) => {
    const docs = await ownedDocs(db, collection, id)
    return Promise.all(docs.map(async (doc) => {
      const nested: Record<string, unknown[]> = {}
      for (const sub of NESTED[collection] ?? []) {
        const snap = await db.collection(collection).doc(doc.id).collection(sub).get()
        nested[sub] = snap.docs.map((d: any) => ({ id: d.id, ...plain(d.data()) }))
      }
      return { id: doc.id, ...plain(doc.data()), ...nested }
    }))
  }

  const simple = async (collection: string, redact: string[] = []) =>
    (await ownedDocs(db, collection, id)).map((doc) => {
      const data = plain(doc.data())
      for (const key of redact) delete data[key]
      return { id: doc.id, ...data }
    })

  const [chats, workflows, agents, memories, servers, usage, files, payments, planDoc, memSettings, notifDoc, connections, keyDocs, connectorAudit, notifLog, legacy] = await Promise.all([
    withNested('chats'),
    withNested('workflows').then(list => list.map(redactWorkflow)),
    simple('agents'),
    simple('memories'),
    ownedDocs(db, 'mcp_servers', id).then(docs => docs.map((doc) => {
      const d = doc.data()
      return { id: doc.id, name: d.name, url: d.url, enabled: d.enabled !== false, approvedTools: Object.keys(d.approved ?? {}), createdAt: plain(d.createdAt) }
    })),
    simple('usage'),
    listedFiles(db, id),
    simple('payments'),
    db.collection('user_plans').doc(id).get(),
    db.collection('memory_settings').doc(id).get(),
    db.collection('user_settings').doc(id).get(),
    deps.listConnections(id).catch(() => []),
    // Which services have a key saved: when, and the last four characters. The key itself is never exported.
    simple('connector_credentials', ['sealed']),
    simple('connector_audit'),
    simple('notification_log'),
    // Older app connections saved before the current connector layer: what they were, never any token they held.
    simple('integrations', LEGACY_SECRETS)
  ])

  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account: { id, name: user.name, email: user.email ?? null },
    plan: planDoc.exists ? plain(planDoc.data()) : { plan: 'free' },
    usage,
    chats,
    workflows,
    agents,
    memory: { enabled: memSettings.exists ? memSettings.data()?.enabled !== false : true, items: memories },
    mcpServers: servers,
    files,
    payments,
    notifications: notifDoc.exists ? plain(notifDoc.data()) : { emailRenewals: true, emailWorkflowFailures: true },
    connectedKeys: keyDocs,
    connectorActivity: connectorAudit,
    notificationLog: notifLog,
    legacyIntegrations: legacy,
    connectedApps: [...new Set((connections as any[]).map(c => c.toolkitSlug).filter(Boolean))]
  }
}

export class AccountDeletionError extends Error {}

/**
 * Removes the person's account and everything listed above. Connected apps are disconnected first, and
 * if that fails nothing is deleted, so a retry starts clean instead of leaving live sign-ins behind.
 * Deleting is repeatable: a half-finished attempt can simply be run again.
 */
export async function eraseUserData(deps: AccountDeps, userId: string): Promise<{ removed: Record<string, number> }> {
  const { db } = deps
  const removed: Record<string, number> = {}

  // First mark the account as going away and sign it out everywhere. From here, nothing that checks the
  // marker (workflow runs, late payments) writes for this person, and their tokens stop working.
  await markDeleting(db, userId)
  // Until data is actually removed, a failure means "nothing happened": the marker comes off again.
  const stopClean = async (message: string): Promise<never> => {
    await clearDeleting(db, userId)
    throw new AccountDeletionError(message)
  }
  try {
    await deps.revokeSessions?.(userId)
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found') return await stopClean('Could not sign you out everywhere, so nothing was deleted. Please try again.')
  }

  let connections: Array<{ id: string }>
  try {
    connections = await deps.listConnections(userId)
  } catch {
    // An unreachable integrations service is not the same as "no connections": deleting now would leave live sign-ins behind.
    return await stopClean('Could not reach the integrations service to disconnect your apps. Nothing was deleted; please try again.')
  }
  const results = await Promise.all(connections.map(c => deps.disconnect(userId, c.id).catch(() => false)))
  if (!results.every(Boolean)) {
    return await stopClean(`Could not disconnect ${results.filter(r => !r).length} of your connected apps. Nothing was deleted; please try again.`)
  }
  removed.connectedApps = connections.length

  const sweep = async () => {
    for (const collection of OWNED) {
      const docs = await ownedDocs(db, collection, userId)
      for (const doc of docs) {
        if (NESTED[collection] && typeof db.recursiveDelete === 'function') await db.recursiveDelete(doc.ref)
        else await doc.ref.delete()
      }
      removed[collection] = (removed[collection] ?? 0) + docs.length
    }
  }
  await sweep()
  for (const collection of PER_PERSON) await db.collection(collection).doc(userId).delete()
  // A run that was already in flight when the marker went up may have written once more: sweep again.
  await sweep()

  // Payment records are kept for the books (tax and disputes), but stop being about a person: the
  // name, email and account link go, the reference, amount and date stay.
  const payments = await ownedDocs(db, 'payments', userId)
  for (const doc of payments) await doc.ref.update({ userId: null, email: null, name: null, anonymisedAt: new Date().toISOString() })
  removed.payments = payments.length

  await deps.deleteAuthUser(userId).catch((err: any) => {
    // Already gone counts as done, which keeps a retry after a partial failure working.
    if (err?.code !== 'auth/user-not-found') throw new AccountDeletionError('Your data was deleted, but the sign-in account could not be removed. Please try again.')
  })
  return { removed }
}
