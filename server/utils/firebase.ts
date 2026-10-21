import { randomBytes } from 'node:crypto'
import { assertNotDeleting, isDeleting, AccountDeletingError } from '../services/account/tombstone'
import { Timestamp } from 'firebase-admin/firestore'
import { getFirebaseDb } from './firebaseAdmin'

export { getFirebaseDb }

function toDate(value: unknown, fallback?: Date): Date | undefined {
  if (value instanceof Timestamp) return value.toDate()
  if (value) return new Date(value as string | number)
  return fallback
}

export interface FirestoreChat {
  id: string
  title: string
  userId: string
  visibility: 'public' | 'private'
  /** The saved agent this chat talks to, if the user picked one. */
  agentId?: string
  createdAt: Date
  updatedAt?: Date
}

export interface FirestoreMessage {
  id: string
  chatId: string
  role: 'user' | 'assistant'
   
  parts: any[]
  createdAt: Date
}

export interface FirestoreVote {
  id: string
  chatId: string
  messageId: string
  userId: string
  isUpvoted: boolean
  createdAt: Date
}

export interface FirestoreWorkflow {
  id: string
  title: string
  description?: string
  userId: string
  status: 'active' | 'draft' | 'paused'
   
  nodes: any[]
   
  edges: any[]
   
  nodeSchemas?: Record<string, any>
  /** Shared secret callers must present to trigger the workflow via its public webhook. */
  webhookSecret?: string
  /** When the timer endpoint should next start this workflow (ISO time). Null or missing: not scheduled. */
  scheduleNextRunAt?: string | null
  scheduleLastRunAt?: string | null
  /** Why a schedule was switched off (for example after repeated failures). */
  scheduleError?: string | null
  /** Scheduled runs that failed one after another. */
  scheduleFailures?: number
  createdAt: Date
  updatedAt?: Date
}

export interface FirestoreWorkflowRun {
  id: string
  workflowId: string
  userId: string
  status: 'completed' | 'failed' | 'running' | 'waiting_approval' | 'rejected'
  approvalNodeId?: string
  approvalPrompt?: string
   
  approvalData?: Record<string, any>
   
  input: any
   
  output: any
   
  logs: any[]
  durationMs: number
  createdAt: Date
}

export async function getUserChats(userId: string): Promise<FirestoreChat[]> {
  const db = getFirebaseDb()
  const snapshot = await db.collection('chats').where('userId', '==', userId).get()

  const chats: FirestoreChat[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    chats.push({
      id: d.id,
      title: data.title || '',
      userId: data.userId || userId,
      visibility: data.visibility || 'private',
      createdAt: toDate(data.createdAt, new Date())!
    })
  })

  return chats.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function getChat(chatId: string): Promise<(FirestoreChat & { messages: FirestoreMessage[] }) | null> {
  const db = getFirebaseDb()
  const chatRef = db.collection('chats').doc(chatId)
  const chatDoc = await chatRef.get()
  if (!chatDoc.exists) {
    return null
  }

  const data = chatDoc.data()!

  // Fetch subcollection messages
  const messagesRef = chatRef.collection('messages')
  const msgSnapshot = await messagesRef.orderBy('createdAt', 'asc').get().catch(async () => {
    // Fallback without ordering if index not yet established
    return await messagesRef.get()
  })

  const messages: FirestoreMessage[] = []
  msgSnapshot.forEach((m) => {
    const mData = m.data()
    messages.push({
      id: m.id,
      chatId,
      role: mData.role || 'user',
      parts: mData.parts || [],
      createdAt: toDate(mData.createdAt, new Date())!
    })
  })

  messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return {
    id: chatDoc.id,
    title: data.title || '',
    userId: data.userId || '',
    visibility: data.visibility || 'private',
    ...(data.agentId ? { agentId: String(data.agentId) } : {}),
    createdAt: toDate(data.createdAt, new Date())!,
    messages
  }
}

export async function createChat(data: {
  id?: string
  title?: string
  userId: string
  visibility?: 'public' | 'private'
  agentId?: string
  initialMessage?: string
  attachments?: Array<{ name?: string; contentType?: string; url: string }>
}): Promise<FirestoreChat> {
  await assertNotDeleting(data.userId)
  const db = getFirebaseDb()
  const chatId = data.id || crypto.randomUUID()
  const now = new Date()

  const chatDocRef = db.collection('chats').doc(chatId)
  await chatDocRef.set({
    id: chatId,
    title: data.title || '',
    userId: data.userId,
    visibility: 'private',
    ...(data.agentId ? { agentId: data.agentId } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  })

  if (data.initialMessage || data.attachments?.length) {
    const msgId = crypto.randomUUID()
     
    const parts: any[] = []
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        parts.push({
          type: 'file',
          mediaType: att.contentType || 'application/octet-stream',
          url: att.url,
          filename: att.name
        })
      }
    }
    if (data.initialMessage) {
      parts.push({ type: 'text', text: data.initialMessage })
    }

    await chatDocRef.collection('messages').doc(msgId).set(sanitizeForFirestore({
      id: msgId,
      chatId,
      role: 'user',
      parts,
      createdAt: now.toISOString()
    }))
  }

  return {
    id: chatId,
    title: data.title || '',
    userId: data.userId,
    visibility: 'private',
    createdAt: now
  }
}

export async function updateChatTitle(chatId: string, title: string): Promise<boolean> {
  await getFirebaseDb().collection('chats').doc(chatId).update({
    title,
    updatedAt: new Date().toISOString()
  })
  return true
}

export async function updateChatVisibility(chatId: string, visibility: 'public' | 'private'): Promise<boolean> {
  await getFirebaseDb().collection('chats').doc(chatId).update({
    visibility,
    updatedAt: new Date().toISOString()
  })
  return true
}

export async function deleteChat(chatId: string): Promise<boolean> {
  const db = getFirebaseDb()
  // Deletes the chat document and its messages/votes subcollections (handles >500 docs).
  await db.recursiveDelete(db.collection('chats').doc(chatId))
  return true
}

// Recursively remove any keys with undefined values or undefined array items to prevent Firestore write errors
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) return null as unknown as T
  if (data === null) return null as unknown as T
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as unknown as T
  }
  if (typeof data === 'object' && !(data instanceof Date) && !(data instanceof Timestamp)) {
     
    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value)
      }
    }
    return cleaned as unknown as T
  }
  return data
}

export async function saveChatMessage(
  chatId: string,
   
  message: { id: string, role: string, parts: any[], createdAt?: Date }
) {
  await getFirebaseDb().collection('chats').doc(chatId).collection('messages').doc(message.id).set(sanitizeForFirestore({
    id: message.id,
    chatId,
    role: message.role,
    parts: message.parts || [],
    createdAt: (message.createdAt || new Date()).toISOString()
  }), { merge: true })
}

/**
 * Saves a conversation. Messages that already exist keep their original `createdAt`
 * (pass them in `existingCreatedAt`); new ones get increasing timestamps in array order,
 * so history order is stable across saves.
 */
export async function saveChatMessages(
  chatId: string,
   
  messages: Array<{ id: string, role: string, parts: any[] }>,
  existingCreatedAt: Map<string, Date> = new Map()
) {
  const db = getFirebaseDb()
  // Nothing is saved under a chat that has been deleted, or for a person whose account is being deleted:
  // a reply that finishes after the final sweep must not leave messages behind.
  const chatDoc = await db.collection('chats').doc(chatId).get()
  if (!chatDoc.exists || await isDeleting(chatDoc.data()?.userId)) return false
  const base = Math.max(Date.now(), ...[...existingCreatedAt.values()].map(d => d.getTime() + 1))
  let offset = 0

  const writes = messages.map((msg) => {
    const createdAt = existingCreatedAt.get(msg.id) ?? new Date(base + offset++)
    return {
      ref: db.collection('chats').doc(chatId).collection('messages').doc(msg.id),
      data: sanitizeForFirestore({
        id: msg.id,
        chatId,
        role: msg.role,
        parts: msg.parts || [],
        createdAt: createdAt.toISOString()
      })
    }
  })

  // Firestore batches are limited to 500 operations.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const w of writes.slice(i, i + 400)) batch.set(w.ref, w.data, { merge: true })
    await batch.commit()
  }
  return true
}

export async function deleteChatMessages(chatId: string, messageIds: string[]) {
  const db = getFirebaseDb()

  // Firestore batches are limited to 500 operations.
  for (let i = 0; i < messageIds.length; i += 400) {
    const batch = db.batch()
    for (const id of messageIds.slice(i, i + 400)) {
      batch.delete(db.collection('chats').doc(chatId).collection('messages').doc(id))
    }
    await batch.commit()
  }
}

export async function getChatVotes(chatId: string): Promise<FirestoreVote[]> {
  const snapshot = await getFirebaseDb().collection('chats').doc(chatId).collection('votes').get()

  const votes: FirestoreVote[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    votes.push({
      id: d.id,
      chatId,
      messageId: data.messageId || d.id,
      userId: data.userId || '',
      isUpvoted: Boolean(data.isUpvoted),
      createdAt: toDate(data.createdAt, new Date())!
    })
  })

  return votes
}

export async function setChatVote(chatId: string, messageId: string, userId: string, isUpvoted?: boolean) {
  const voteRef = getFirebaseDb().collection('chats').doc(chatId).collection('votes').doc(messageId)

  if (isUpvoted === undefined) {
    await voteRef.delete()
  } else {
    await voteRef.set({
      id: messageId,
      chatId,
      messageId,
      userId,
      isUpvoted,
      createdAt: new Date().toISOString()
    })
  }
}

// ==================== WORKFLOWS ====================

 
export function toWorkflow(id: string, data: Record<string, any>, userIdFallback = ''): FirestoreWorkflow {
  return {
    id,
    title: data.title || 'Untitled Workflow',
    description: data.description || '',
    userId: data.userId || userIdFallback,
    status: data.status || 'draft',
    nodes: data.nodes || [],
    edges: data.edges || [],
    nodeSchemas: data.nodeSchemas || {},
    webhookSecret: data.webhookSecret || undefined,
    scheduleNextRunAt: data.scheduleNextRunAt ?? null,
    scheduleLastRunAt: data.scheduleLastRunAt ?? null,
    scheduleError: data.scheduleError ?? null,
    scheduleFailures: Number(data.scheduleFailures) || 0,
    createdAt: toDate(data.createdAt, new Date())!,
    updatedAt: toDate(data.updatedAt)
  }
}

/**
 * The built-in "client-onboarding-pipeline" / "default" aliases point at a per-user copy,
 * never at a shared document.
 */
export function resolveWorkflowId(userId: string, id: string): string {
  return id === 'client-onboarding-pipeline' || id === 'default'
    ? `client-onboarding-pipeline__${userId}`
    : id
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString('hex')
}

export async function getUserWorkflows(userId: string): Promise<FirestoreWorkflow[]> {
  const snapshot = await getFirebaseDb().collection('workflows').where('userId', '==', userId).get()

  const list: FirestoreWorkflow[] = []
  snapshot.forEach((d) => {
    list.push(toWorkflow(d.id, d.data(), userId))
  })

  return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function getWorkflow(workflowId: string): Promise<FirestoreWorkflow | null> {
  const workflowDoc = await getFirebaseDb().collection('workflows').doc(workflowId).get()
  if (!workflowDoc.exists) {
    return null
  }
  return toWorkflow(workflowDoc.id, workflowDoc.data()!)
}

export async function createWorkflow(data: {
  id?: string
  title: string
  description?: string
  userId: string
   
  nodes: any[]
   
  edges: any[]
   
  nodeSchemas?: Record<string, any>
  status?: 'active' | 'draft' | 'paused'
  scheduleNextRunAt?: string | null
}): Promise<FirestoreWorkflow> {
  await assertNotDeleting(data.userId)
  const workflowId = data.id || crypto.randomUUID()
  const now = new Date()

  const workflow: FirestoreWorkflow = {
    id: workflowId,
    title: data.title,
    description: data.description || '',
    userId: data.userId,
    status: data.status || 'active',
    nodes: data.nodes || [],
    edges: data.edges || [],
    nodeSchemas: data.nodeSchemas || {},
    webhookSecret: generateWebhookSecret(),
    scheduleNextRunAt: data.scheduleNextRunAt ?? null,
    createdAt: now,
    updatedAt: now
  }

  // create() fails if the id already exists, so one user can never overwrite another's workflow.
  await getFirebaseDb().collection('workflows').doc(workflowId).create(sanitizeForFirestore({
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    userId: workflow.userId,
    status: workflow.status,
    nodes: workflow.nodes,
    edges: workflow.edges,
    nodeSchemas: workflow.nodeSchemas,
    webhookSecret: workflow.webhookSecret,
    scheduleNextRunAt: workflow.scheduleNextRunAt ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }))

  return workflow
}

const DEFAULT_WORKFLOW_ALIAS = 'client-onboarding-pipeline'
const RESERVED_ID_PREFIX = `${DEFAULT_WORKFLOW_ALIAS}__`

/** Client-supplied ids may not target another user's reserved per-user default id. */
export function isReservedWorkflowId(userId: string, id: string): boolean {
  return id.startsWith(RESERVED_ID_PREFIX) && id !== `${RESERVED_ID_PREFIX}${userId}`
}

const isAlreadyExists = (err: any) => err?.code === 6 || /already exists/i.test(err?.message || '')

/**
 * The caller's own copy of the built-in pipeline, persisted on first use so runs, approvals and
 * edits always point at a real document. A bare legacy `client-onboarding-pipeline` document the
 * caller owns is migrated into the per-user id instead of being orphaned.
 */
export async function ensureDefaultWorkflow(
  userId: string,
  seed: { nodes: any[], edges: any[] }
): Promise<FirestoreWorkflow> {
  const id = resolveWorkflowId(userId, DEFAULT_WORKFLOW_ALIAS)
  const existing = await getWorkflow(id)
  if (existing) return existing

  const legacy = await getWorkflow(DEFAULT_WORKFLOW_ALIAS)
  const base = legacy && legacy.userId === userId
    ? { title: legacy.title, description: legacy.description, nodes: legacy.nodes, edges: legacy.edges, nodeSchemas: legacy.nodeSchemas, status: legacy.status }
    : {
        title: 'Client Onboarding Pipeline',
        description: 'Auto-triages new client inquiries from Gmail, drafts proposals, checks meeting availability, saves to Drive, and alerts Slack.',
        nodes: seed.nodes,
        edges: seed.edges,
        nodeSchemas: undefined,
        status: 'draft' as const
      }

  try {
    return await createWorkflow({ id, userId, ...base })
  } catch (err: any) {
    // Only a concurrent create is benign; anything else must surface.
    if (!isAlreadyExists(err)) throw err
    const created = await getWorkflow(id)
    if (!created) throw err
    return created
  }
}

/** Gives a workflow a webhook secret exactly once, even with concurrent first reads. */
export async function ensureWebhookSecret(workflowId: string): Promise<string> {
  const db = getFirebaseDb()
  const ref = db.collection('workflows').doc(workflowId)
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.data()?.webhookSecret
    if (current) return current as string
    const secret = generateWebhookSecret()
    tx.update(ref, { webhookSecret: secret, updatedAt: new Date().toISOString() })
    return secret
  })
}

export async function updateWorkflow(workflowId: string, data: Partial<FirestoreWorkflow>): Promise<void> {
  await getFirebaseDb().collection('workflows').doc(workflowId).update(sanitizeForFirestore({
    ...data,
    updatedAt: new Date().toISOString()
  }))
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const db = getFirebaseDb()
  // Also removes the runs subcollection.
  await db.recursiveDelete(db.collection('workflows').doc(workflowId))
}

 
function toWorkflowRun(id: string, workflowId: string, data: Record<string, any>): FirestoreWorkflowRun {
  return {
    id,
    workflowId,
    userId: data.userId || '',
    status: data.status || 'completed',
    approvalNodeId: data.approvalNodeId || undefined,
    approvalPrompt: data.approvalPrompt || undefined,
    approvalData: data.approvalData || undefined,
    input: data.input || {},
    output: data.output || {},
    logs: data.logs || [],
    durationMs: data.durationMs || 0,
    createdAt: toDate(data.createdAt, new Date())!
  }
}

export async function saveWorkflowRun(workflowId: string, run: Omit<FirestoreWorkflowRun, 'createdAt' | 'id'> & { id?: string, createdAt?: Date }): Promise<FirestoreWorkflowRun> {
  const runId = run.id || crypto.randomUUID()
  const now = run.createdAt || new Date()

  const runDoc: FirestoreWorkflowRun = {
    ...run,
    id: runId,
    createdAt: now
  }

  // A run that finishes after its owner asked for deletion must not write anything back.
  if (await isDeleting(run.userId)) throw new AccountDeletingError()

  await getFirebaseDb().collection('workflows').doc(workflowId).collection('runs').doc(runId).set(sanitizeForFirestore({
    id: runDoc.id,
    workflowId,
    userId: runDoc.userId,
    status: runDoc.status,
    approvalNodeId: runDoc.approvalNodeId || null,
    approvalPrompt: runDoc.approvalPrompt || null,
    approvalData: runDoc.approvalData || null,
    input: runDoc.input,
    output: runDoc.output,
    logs: runDoc.logs,
    durationMs: runDoc.durationMs,
    createdAt: now.toISOString()
  }))

  return runDoc
}

export async function getWorkflowRun(workflowId: string, runId: string): Promise<FirestoreWorkflowRun | null> {
  const runDoc = await getFirebaseDb().collection('workflows').doc(workflowId).collection('runs').doc(runId).get()
  if (!runDoc.exists) {
    return null
  }
  return toWorkflowRun(runDoc.id, workflowId, runDoc.data()!)
}

export async function updateWorkflowRun(workflowId: string, runId: string, data: { [K in keyof FirestoreWorkflowRun]?: FirestoreWorkflowRun[K] | null }): Promise<void> {
  await getFirebaseDb().collection('workflows').doc(workflowId).collection('runs').doc(runId).update(sanitizeForFirestore({
    ...data
  }))
}

export async function getWorkflowRuns(workflowId: string): Promise<FirestoreWorkflowRun[]> {
  const snapshot = await getFirebaseDb().collection('workflows').doc(workflowId).collection('runs').get()

  const list: FirestoreWorkflowRun[] = []
  snapshot.forEach((d) => {
    list.push(toWorkflowRun(d.id, workflowId, d.data()))
  })

  return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

// ==================== INTEGRATIONS ====================
// Connections live in Composio. Only the cleanup of legacy "marked as connected" records remains here.

export async function deleteIntegration(userId: string, provider: string): Promise<void> {
  await getFirebaseDb().collection('integrations').doc(`${userId}_${provider}`).delete()
}
