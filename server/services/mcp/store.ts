import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import type { ApprovedTool } from './tools'
import type { McpServer } from './server'
import { MCP_LIMITS, McpConflict, McpError } from './tools'

const COLLECTION = 'mcp_servers'

function fromDoc(id: string, data: Record<string, any>): McpServer {
  const approved: Record<string, ApprovedTool> = {}
  for (const [name, t] of Object.entries(data.approved && typeof data.approved === 'object' ? data.approved : {}) as Array<[string, any]>) {
    if (t && typeof t.fingerprint === 'string') approved[name] = { fingerprint: t.fingerprint, description: String(t.description ?? ''), inputSchema: t.inputSchema ?? { type: 'object', properties: {} } }
  }
  return {
    id,
    userId: String(data.userId || ''),
    name: String(data.name || 'MCP server'),
    url: String(data.url || ''),
    headerName: String(data.headerName || 'Authorization'),
    sealedToken: String(data.sealedToken || ''),
    enabled: data.enabled !== false,
    approved,
    lastError: String(data.lastError || ''),
    driftNote: String(data.driftNote || ''),
    createdAt: String(data.createdAt || ''),
    updatedAt: String(data.updatedAt || '')
  }
}

export async function listServers(userId: string): Promise<McpServer[]> {
  const snap = await getFirebaseDb().collection(COLLECTION).where('userId', '==', userId).get()
  return snap.docs.map(d => fromDoc(d.id, d.data())).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getServer(id: string): Promise<McpServer | null> {
  const doc = await getFirebaseDb().collection(COLLECTION).doc(id).get()
  return doc.exists ? fromDoc(doc.id, doc.data()!) : null
}

/**
 * Adds a server unless the person is at the limit or already has that address. The check and the write are one
 * transaction, so simultaneous requests cannot all pass against the same count.
 */
export async function createServer(userId: string, input: Pick<McpServer, 'name' | 'url' | 'headerName' | 'sealedToken'>): Promise<McpServer> {
  await assertNotDeleting(userId)
  const now = new Date().toISOString()
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc()
  const doc = { ...input, userId, enabled: true, approved: {}, lastError: '', driftNote: '', createdAt: now, updatedAt: now }
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    if (existing.docs.length >= MCP_LIMITS.maxServersPerUser) throw new McpConflict(`You can connect up to ${MCP_LIMITS.maxServersPerUser} MCP servers. Remove one to add another.`)
    if (existing.docs.some(d => d.data().url === input.url)) throw new McpConflict('That server is already connected.')
    tx.set(ref, doc)
  })
  return fromDoc(ref.id, doc)
}

/**
 * Stores a person's approvals for one server. The count of tools approved on their other servers is read in the
 * same transaction, so two approvals at once cannot both fit under a limit that only one of them fits under.
 */
export async function setApprovals(userId: string, id: string, plan: (othersApproved: number) => Record<string, ApprovedTool>): Promise<McpServer> {
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc(id)
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()!.userId !== userId) throw new McpError('Server not found')
    const all = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    const others = all.docs.filter(d => d.id !== id).map(d => fromDoc(d.id, d.data()))
    const approved = plan(approvedCount(others))
    const patch = { approved, lastError: '', driftNote: '', updatedAt: new Date().toISOString() }
    tx.update(ref, patch)
    return fromDoc(id, { ...snap.data()!, ...patch })
  })
}

export type ServerPatch = Partial<Pick<McpServer, 'name' | 'headerName' | 'sealedToken' | 'enabled' | 'approved' | 'lastError' | 'driftNote'>>

/** Only these fields can change after creation; the address is fixed so an approved server cannot be pointed elsewhere. */
export async function updateServer(id: string, patch: Partial<Pick<McpServer, 'name' | 'headerName' | 'sealedToken' | 'enabled' | 'approved' | 'lastError' | 'driftNote'>>): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).update({ ...patch, updatedAt: new Date().toISOString() })
}

/**
 * Changes a server's settings against the server as it is stored right now, in one transaction. A new sign-in
 * switches approvals off based on what is stored at that moment, so an approval saved a moment earlier cannot
 * survive a token change.
 */
export async function updateServerFor(userId: string, id: string, build: (current: McpServer) => ServerPatch): Promise<McpServer> {
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc(id)
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()!.userId !== userId) throw new McpError('Server not found')
    const current = fromDoc(id, snap.data()!)
    const patch = { ...build(current), updatedAt: new Date().toISOString() }
    tx.update(ref, patch)
    return fromDoc(id, { ...snap.data()!, ...patch })
  })
}

export async function deleteServer(id: string): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).delete()
}

export const approvedCount = (servers: McpServer[], exceptId?: string) =>
  servers.filter(s => s.id !== exceptId).reduce((n, s) => n + Object.keys(s.approved).length, 0)
