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
  createdAt: Date
  updatedAt?: Date
}

export interface FirestoreMessage {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeSchemas?: Record<string, any>
  createdAt: Date
  updatedAt?: Date
}

export interface FirestoreWorkflowRun {
  id: string
  workflowId: string
  userId: string
  status: 'completed' | 'failed' | 'running' | 'waiting_approval'
  approvalNodeId?: string
  approvalPrompt?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approvalData?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs: any[]
  durationMs: number
  createdAt: Date
}

export interface FirestoreIntegration {
  id: string
  userId: string
  provider: 'gmail' | 'slack' | 'google_drive' | 'notion' | 'github'
  name: string
  status: 'connected' | 'disconnected'
  account: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>
  updatedAt: Date
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
    createdAt: toDate(data.createdAt, new Date())!,
    messages
  }
}

export async function createChat(data: {
  id?: string
  title?: string
  userId: string
  visibility?: 'public' | 'private'
  initialMessage?: string
  attachments?: Array<{ name?: string; contentType?: string; url: string }>
}): Promise<FirestoreChat> {
  const db = getFirebaseDb()
  const chatId = data.id || crypto.randomUUID()
  const now = new Date()

  const chatDocRef = db.collection('chats').doc(chatId)
  await chatDocRef.set({
    id: chatId,
    title: data.title || '',
    userId: data.userId,
    visibility: 'private',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  })

  if (data.initialMessage || data.attachments?.length) {
    const msgId = crypto.randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      experimental_attachments: data.attachments || [],
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function saveChatMessages(
  chatId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: Array<{ id: string, role: string, parts: any[] }>
) {
  const db = getFirebaseDb()
  const batch = db.batch()

  for (const msg of messages) {
    const ref = db.collection('chats').doc(chatId).collection('messages').doc(msg.id)
    batch.set(ref, sanitizeForFirestore({
      id: msg.id,
      chatId,
      role: msg.role,
      parts: msg.parts || [],
      createdAt: new Date().toISOString()
    }), { merge: true })
  }

  await batch.commit()
}

export async function deleteChatMessages(chatId: string, messageIds: string[]) {
  const db = getFirebaseDb()
  const batch = db.batch()

  for (const id of messageIds) {
    batch.delete(db.collection('chats').doc(chatId).collection('messages').doc(id))
  }

  await batch.commit()
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toWorkflow(id: string, data: Record<string, any>, userIdFallback = ''): FirestoreWorkflow {
  return {
    id,
    title: data.title || 'Untitled Workflow',
    description: data.description || '',
    userId: data.userId || userIdFallback,
    status: data.status || 'draft',
    nodes: data.nodes || [],
    edges: data.edges || [],
    nodeSchemas: data.nodeSchemas || {},
    createdAt: toDate(data.createdAt, new Date())!,
    updatedAt: toDate(data.updatedAt)
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeSchemas?: Record<string, any>
  status?: 'active' | 'draft' | 'paused'
}): Promise<FirestoreWorkflow> {
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
    createdAt: now,
    updatedAt: now
  }

  await getFirebaseDb().collection('workflows').doc(workflowId).set(sanitizeForFirestore({
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    userId: workflow.userId,
    status: workflow.status,
    nodes: workflow.nodes,
    edges: workflow.edges,
    nodeSchemas: workflow.nodeSchemas,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }))

  return workflow
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toWorkflowRun(id: string, workflowId: string, data: Record<string, any>): FirestoreWorkflowRun {
  return {
    id,
    workflowId,
    userId: data.userId || '',
    status: data.status || 'completed',
    approvalNodeId: data.approvalNodeId,
    approvalPrompt: data.approvalPrompt,
    approvalData: data.approvalData,
    input: data.input || {},
    output: data.output || {},
    logs: data.logs || [],
    durationMs: data.durationMs || 0,
    createdAt: toDate(data.createdAt, new Date())!
  }
}

export async function saveWorkflowRun(workflowId: string, run: Omit<FirestoreWorkflowRun, 'createdAt'> & { createdAt?: Date }): Promise<FirestoreWorkflowRun> {
  const runId = run.id || crypto.randomUUID()
  const now = run.createdAt || new Date()

  const runDoc: FirestoreWorkflowRun = {
    ...run,
    id: runId,
    createdAt: now
  }

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

export async function updateWorkflowRun(workflowId: string, runId: string, data: Partial<FirestoreWorkflowRun>): Promise<void> {
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

export async function getUserIntegrations(userId: string): Promise<FirestoreIntegration[]> {
  const snapshot = await getFirebaseDb().collection('integrations').where('userId', '==', userId).get()

  const list: FirestoreIntegration[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    list.push({
      id: d.id,
      userId: data.userId || userId,
      provider: data.provider,
      name: data.name || data.provider,
      status: data.status || 'connected',
      account: data.account || '',
      config: data.config || {},
      updatedAt: toDate(data.updatedAt, new Date())!
    })
  })

  return list
}

export async function upsertIntegration(
  userId: string,
  integration: Omit<FirestoreIntegration, 'id' | 'updatedAt' | 'userId'> & { id?: string }
): Promise<FirestoreIntegration> {
  const docId = `${userId}_${integration.provider}`
  const now = new Date()

  const docData: FirestoreIntegration = {
    id: docId,
    userId,
    provider: integration.provider,
    name: integration.name,
    status: integration.status,
    account: integration.account,
    config: integration.config || {},
    updatedAt: now
  }

  await getFirebaseDb().collection('integrations').doc(docId).set(sanitizeForFirestore({
    id: docData.id,
    userId: docData.userId,
    provider: docData.provider,
    name: docData.name,
    status: docData.status,
    account: docData.account,
    config: docData.config,
    updatedAt: now.toISOString()
  }), { merge: true })

  return docData
}

export async function deleteIntegration(userId: string, provider: string): Promise<void> {
  await getFirebaseDb().collection('integrations').doc(`${userId}_${provider}`).delete()
}
