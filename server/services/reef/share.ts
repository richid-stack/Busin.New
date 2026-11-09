import crypto from 'node:crypto'
import { assertNotDeleting } from '../account/tombstone'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { TOOL_GROUPS, agentInputSchema } from '../agents/profile'
import type { Agent, AgentInput } from '../agents/profile'
import type { TaskDb } from '../tasks/store'
import { scanText } from './scan'
import type { ScanResult } from './scan'

/**
 * Sharing by link (The Reef, slice 9.1). A person publishes one of their agents; it becomes a page anyone
 * can read at an unguessable address, and anyone signed in can install their own copy. A share is a
 * snapshot of text and settings, never of the person's account: no model, key, chat, memory or connection.
 */

export const SHARE_LIMITS = {
  /** Links one person may have. */
  maxPerUser: 20,
  /** Different people who must report a share before it is hidden until looked at. */
  reportsToHide: 3,
  noteMax: 300
}

export const REPORT_REASONS = ['secret', 'harmful', 'spam', 'other'] as const
export type ReportReason = typeof REPORT_REASONS[number]

export class ShareError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'limit' | 'blocked' | 'invalid' | 'conflict' = 'invalid', readonly scan?: ScanResult) { super(message) }
}

/** What is copied out of an agent. The model is left out on purpose: it may be the person's own key. */
export type SharedAgent = Pick<AgentInput, 'name' | 'description' | 'instructions' | 'tools' | 'skills' | 'maxSteps'>

export interface Need { id: string, label: string, detail: string, sensitive: boolean }

export interface SharedItem {
  id: string
  userId: string
  kind: 'agent'
  agentId: string
  title: string
  description: string
  payload: SharedAgent
  needs: Need[]
  scan: ScanResult
  version: number
  authorName: string
  installs: number
  hidden: boolean
  createdAt: string
  updatedAt: string
}

export const newShareId = () => crypto.randomBytes(12).toString('base64url')

export function payloadOf(agent: Pick<Agent, 'name' | 'description' | 'instructions' | 'tools' | 'skills' | 'maxSteps'>): SharedAgent {
  const { name, description, instructions, tools, skills, maxSteps } = agentInputSchema.parse({ ...agent, model: null })
  return { name, description, instructions, tools, skills, maxSteps }
}

/** What the thing can do once installed, in the same words as the agent editor. */
export function needsOf(payload: Pick<SharedAgent, 'tools'>): Need[] {
  return TOOL_GROUPS.filter(g => payload.tools.includes(g.id)).map(g => ({ id: g.id, label: g.label, detail: g.detail, sensitive: Boolean(g.sensitive) }))
}

export function scanPayload(payload: SharedAgent): ScanResult {
  return scanText({ name: payload.name, description: payload.description, instructions: payload.instructions })
}

function fromDoc(id: string, d: Record<string, any>): SharedItem {
  return {
    id,
    userId: String(d.userId || ''),
    kind: 'agent',
    agentId: String(d.agentId || ''),
    title: String(d.title || ''),
    description: String(d.description || ''),
    payload: d.payload,
    needs: Array.isArray(d.needs) ? d.needs : [],
    scan: d.scan ?? { verdict: 'ok', findings: [] },
    version: Number(d.version) || 1,
    authorName: String(d.authorName || ''),
    installs: Number(d.installs) || 0,
    hidden: d.hidden === true,
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || '')
  }
}

/** What anyone with the link sees. No owner id, no agent id. */
export function publicShare(s: SharedItem): Omit<SharedItem, 'userId' | 'agentId'> {
  const rest: Record<string, unknown> = { ...s }
  delete rest.userId
  delete rest.agentId
  return rest as Omit<SharedItem, 'userId' | 'agentId'>
}

/**
 * Turns a share into the agent a person gets. Groups that reach into accounts or outside servers
 * come switched off unless the person ticked them, so a stranger's agent cannot use the apps you
 * already connected just because you installed it. Skills this server does not have are left out.
 */
export function agentFromShare(payload: SharedAgent, allow: string[], knownSkills: Set<string>): { input: AgentInput, withheld: Need[], droppedSkills: string[] } {
  const needs = needsOf(payload)
  const kept = needs.filter(n => !n.sensitive || allow.includes(n.id)).map(n => n.id)
  const droppedSkills = payload.skills.filter(s => !knownSkills.has(s))
  const input = agentInputSchema.parse({ ...payload, model: null, tools: kept, skills: payload.skills.filter(s => knownSkills.has(s)) })
  return { input, withheld: needs.filter(n => n.sensitive && !allow.includes(n.id)), droppedSkills }
}

export interface InstallDeps {
  skills: Set<string>
  /** How many agents the person already has and the most they may have. */
  agentCount: (userId: string) => Promise<number>
  maxAgents: number
  createAgent: (userId: string, input: AgentInput, source: { shareId: string, version: number, author: string }) => Promise<Agent>
}

const COLLECTION = 'shared_items'
const REPORTS = 'share_reports'

export function createShareStore(db: TaskDb, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))()
  const ref = (id: string) => db.collection(COLLECTION).doc(id)
  const mineAll = async (userId: string) => (await db.collection(COLLECTION).where('userId', '==', userId).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as SharedItem[]

  return {
    /** Publishes an agent, or publishes a new version of one already shared. Throws ShareError('blocked') with the findings. */
    async publish(userId: string, authorName: string, agent: Agent): Promise<SharedItem> {
      await assertNotDeleting(userId, db as any)
      const payload = payloadOf(agent)
      const scan = scanPayload(payload)
      if (scan.verdict === 'blocked') throw new ShareError('This cannot be shared yet. Fix what is listed and try again.', 'blocked', scan)

      const existing = (await mineAll(userId))
      const at = now().toISOString()
      const fields = { title: payload.name, description: payload.description, payload, needs: needsOf(payload), scan, authorName: authorName.slice(0, 60) || 'Someone', updatedAt: at }
      const same = existing.find(s => s.agentId === agent.id)
      if (same) {
        const next = { ...fields, version: same.version + 1 }
        await ref(same.id).update(next)
        return fromDoc(same.id, { ...same, ...next })
      }
      if (existing.length >= SHARE_LIMITS.maxPerUser) throw new ShareError(`You can have ${SHARE_LIMITS.maxPerUser} shared links. Remove one first.`, 'limit')
      const id = newShareId()
      const doc = { userId, kind: 'agent', agentId: agent.id, ...fields, version: 1, installs: 0, hidden: false, createdAt: at }
      await ref(id).set(doc)
      return fromDoc(id, doc)
    },

    listMine: async (userId: string) => (await mineAll(userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

    /** One share, as a stranger sees it. A hidden or missing one is "not found" for everyone but its owner. */
    async get(id: string, viewerId?: string | null): Promise<SharedItem> {
      const snap = await ref(id).get()
      if (!snap.exists) throw new ShareError('This link does not exist, or it was removed.', 'not_found')
      const s = fromDoc(snap.id, snap.data())
      if (s.hidden && s.userId !== viewerId) throw new ShareError('This was taken down while it is being looked at.', 'not_found')
      return s
    },

    async remove(userId: string, id: string): Promise<void> {
      const snap = await ref(id).get()
      if (!snap.exists || snap.data().userId !== userId) throw new ShareError('Share not found.', 'not_found')
      await ref(id).delete()
    },

    /** Makes a copy in the installer's account. */
    async install(userId: string, id: string, allow: string[], deps: InstallDeps): Promise<{ agent: Agent, withheld: Need[], droppedSkills: string[] }> {
      await assertNotDeleting(userId, db as any)
      const s = await this.get(id, userId)
      if (s.scan.verdict === 'blocked') throw new ShareError('This was flagged and cannot be installed.', 'blocked', s.scan)
      if ((await deps.agentCount(userId)) >= deps.maxAgents) throw new ShareError(`You can keep up to ${deps.maxAgents} agents. Delete one to add another.`, 'limit')
      const { input, withheld, droppedSkills } = agentFromShare(s.payload, allow, deps.skills)
      const agent = await deps.createAgent(userId, input, { shareId: s.id, version: s.version, author: s.authorName })
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (snap.exists) tx.update(ref(id), { installs: (Number(snap.data().installs) || 0) + 1 })
      })
      return { agent, withheld, droppedSkills }
    },

    /** A person reports a share. Several different people hide it until someone has looked. */
    async report(userId: string, id: string, reason: ReportReason, note: string): Promise<{ hidden: boolean }> {
      const s = await this.get(id, userId)
      if (s.userId === userId) throw new ShareError('You cannot report your own share. Remove it instead.', 'conflict')
      await db.collection(REPORTS).doc(`${id}__${userId}`).set({ userId, shareId: id, reason, note: note.slice(0, SHARE_LIMITS.noteMax), createdAt: now().toISOString() })
      const reporters = new Set((await db.collection(REPORTS).where('shareId', '==', id).get()).docs.map((d: any) => d.data().userId))
      const hide = reporters.size >= SHARE_LIMITS.reportsToHide
      if (hide && !s.hidden) await ref(id).update({ hidden: true, updatedAt: now().toISOString() })
      return { hidden: hide }
    }
  }
}

export type ShareStore = ReturnType<typeof createShareStore>

let shared: ShareStore | undefined
export const shareStore = () => (shared ??= createShareStore(getFirebaseDb() as unknown as TaskDb))
