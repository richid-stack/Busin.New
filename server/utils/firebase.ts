import { initializeApp, getApps } from 'firebase/app'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  Timestamp,
  writeBatch
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../../firebase-applet-config.json', import.meta.url), 'utf-8'))

function getApp() {
  const apps = getApps()
  if (apps.length > 0 && apps[0]) {
    return apps[0]
  }
  return initializeApp(config, 'ai-studio-server')
}

export function getFirebaseDb() {
  const app = getApp()
  return getFirestore(app, config.firestoreDatabaseId || '(default)')
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
  createdAt: Date
  updatedAt?: Date
}

export interface FirestoreWorkflowRun {
  id: string
  workflowId: string
  userId: string
  status: 'completed' | 'failed' | 'running'
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
  const chatsRef = collection(db, 'chats')
  const q = query(chatsRef, where('userId', '==', userId))
  const snapshot = await getDocs(q)

  const chats: FirestoreChat[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    const createdAt = data.createdAt instanceof Timestamp
      ? data.createdAt.toDate()
      : (data.createdAt ? new Date(data.createdAt) : new Date())

    chats.push({
      id: d.id,
      title: data.title || '',
      userId: data.userId || userId,
      visibility: data.visibility || 'private',
      createdAt
    })
  })

  return chats.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function getChat(chatId: string): Promise<(FirestoreChat & { messages: FirestoreMessage[] }) | null> {
  const db = getFirebaseDb()
  const chatDoc = await getDoc(doc(db, 'chats', chatId))
  if (!chatDoc.exists()) {
    return null
  }

  const data = chatDoc.data()
  const createdAt = data.createdAt instanceof Timestamp
    ? data.createdAt.toDate()
    : (data.createdAt ? new Date(data.createdAt) : new Date())

  // Fetch subcollection messages
  const messagesRef = collection(db, 'chats', chatId, 'messages')
  const msgQuery = query(messagesRef, orderBy('createdAt', 'asc'))
  const msgSnapshot = await getDocs(msgQuery).catch(async () => {
    // Fallback without ordering if index not yet established
    return await getDocs(messagesRef)
  })

  const messages: FirestoreMessage[] = []
  msgSnapshot.forEach((m) => {
    const mData = m.data()
    const mCreatedAt = mData.createdAt instanceof Timestamp
      ? mData.createdAt.toDate()
      : (mData.createdAt ? new Date(mData.createdAt) : new Date())

    messages.push({
      id: m.id,
      chatId,
      role: mData.role || 'user',
      parts: mData.parts || [],
      createdAt: mCreatedAt
    })
  })

  messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return {
    id: chatDoc.id,
    title: data.title || '',
    userId: data.userId || '',
    visibility: data.visibility || 'private',
    createdAt,
    messages
  }
}

export async function createChat(data: {
  id?: string
  title?: string
  userId: string
  initialMessage?: string
  attachments?: Array<{ name?: string; contentType?: string; url: string }>
}): Promise<FirestoreChat> {
  const db = getFirebaseDb()
  const chatId = data.id || crypto.randomUUID()
  const now = new Date()

  const chatDocRef = doc(db, 'chats', chatId)
  await setDoc(chatDocRef, {
    id: chatId,
    title: data.title || '',
    userId: data.userId,
    visibility: 'private',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  })

  if (data.initialMessage || data.attachments?.length) {
    const msgId = crypto.randomUUID()
    const msgRef = doc(db, 'chats', chatId, 'messages', msgId)
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

    await setDoc(msgRef, {
      id: msgId,
      chatId,
      role: 'user',
      parts,
      experimental_attachments: data.attachments || [],
      createdAt: now.toISOString()
    })
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
  const db = getFirebaseDb()
  const chatRef = doc(db, 'chats', chatId)
  await updateDoc(chatRef, {
    title,
    updatedAt: new Date().toISOString()
  })
  return true
}

export async function updateChatVisibility(chatId: string, visibility: 'public' | 'private'): Promise<boolean> {
  const db = getFirebaseDb()
  const chatRef = doc(db, 'chats', chatId)
  await updateDoc(chatRef, {
    visibility,
    updatedAt: new Date().toISOString()
  })
  return true
}

export async function deleteChat(chatId: string): Promise<boolean> {
  const db = getFirebaseDb()
  // Delete subcollection messages
  const messagesRef = collection(db, 'chats', chatId, 'messages')
  const msgSnap = await getDocs(messagesRef)
  const batch = writeBatch(db)

  msgSnap.forEach((d) => {
    batch.delete(d.ref)
  })

  // Delete subcollection votes
  const votesRef = collection(db, 'chats', chatId, 'votes')
  const voteSnap = await getDocs(votesRef)
  voteSnap.forEach((d) => {
    batch.delete(d.ref)
  })

  // Delete chat doc
  batch.delete(doc(db, 'chats', chatId))
  await batch.commit()
  return true
}

// Recursively remove any keys with undefined values or undefined array items to prevent Firestore WriteBatch errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const db = getFirebaseDb()
  const msgRef = doc(db, 'chats', chatId, 'messages', message.id)
  await setDoc(msgRef, sanitizeForFirestore({
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
  const batch = writeBatch(db)

  for (const msg of messages) {
    const ref = doc(db, 'chats', chatId, 'messages', msg.id)
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
  const batch = writeBatch(db)

  for (const id of messageIds) {
    const ref = doc(db, 'chats', chatId, 'messages', id)
    batch.delete(ref)
  }

  await batch.commit()
}

export async function getChatVotes(chatId: string): Promise<FirestoreVote[]> {
  const db = getFirebaseDb()
  const votesRef = collection(db, 'chats', chatId, 'votes')
  const snapshot = await getDocs(votesRef)

  const votes: FirestoreVote[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    votes.push({
      id: d.id,
      chatId,
      messageId: data.messageId || d.id,
      userId: data.userId || '',
      isUpvoted: Boolean(data.isUpvoted),
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date()
    })
  })

  return votes
}

export async function setChatVote(chatId: string, messageId: string, userId: string, isUpvoted?: boolean) {
  const db = getFirebaseDb()
  const voteRef = doc(db, 'chats', chatId, 'votes', messageId)

  if (isUpvoted === undefined) {
    await deleteDoc(voteRef)
  } else {
    await setDoc(voteRef, {
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

export async function getUserWorkflows(userId: string): Promise<FirestoreWorkflow[]> {
  const db = getFirebaseDb()
  const workflowsRef = collection(db, 'workflows')
  const q = query(workflowsRef, where('userId', '==', userId))
  const snapshot = await getDocs(q)

  const list: FirestoreWorkflow[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    const createdAt = data.createdAt instanceof Timestamp
      ? data.createdAt.toDate()
      : (data.createdAt ? new Date(data.createdAt) : new Date())
    const updatedAt = data.updatedAt instanceof Timestamp
      ? data.updatedAt.toDate()
      : (data.updatedAt ? new Date(data.updatedAt) : undefined)

    list.push({
      id: d.id,
      title: data.title || 'Untitled Workflow',
      description: data.description || '',
      userId: data.userId || userId,
      status: data.status || 'draft',
      nodes: data.nodes || [],
      edges: data.edges || [],
      createdAt,
      updatedAt
    })
  })

  return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function getWorkflow(workflowId: string): Promise<FirestoreWorkflow | null> {
  const db = getFirebaseDb()
  const workflowDoc = await getDoc(doc(db, 'workflows', workflowId))
  if (!workflowDoc.exists()) {
    return null
  }

  const data = workflowDoc.data()
  const createdAt = data.createdAt instanceof Timestamp
    ? data.createdAt.toDate()
    : (data.createdAt ? new Date(data.createdAt) : new Date())
  const updatedAt = data.updatedAt instanceof Timestamp
    ? data.updatedAt.toDate()
    : (data.updatedAt ? new Date(data.updatedAt) : undefined)

  return {
    id: workflowDoc.id,
    title: data.title || 'Untitled Workflow',
    description: data.description || '',
    userId: data.userId || '',
    status: data.status || 'draft',
    nodes: data.nodes || [],
    edges: data.edges || [],
    createdAt,
    updatedAt
  }
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
  status?: 'active' | 'draft' | 'paused'
}): Promise<FirestoreWorkflow> {
  const db = getFirebaseDb()
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
    createdAt: now,
    updatedAt: now
  }

  await setDoc(doc(db, 'workflows', workflowId), sanitizeForFirestore({
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    userId: workflow.userId,
    status: workflow.status,
    nodes: workflow.nodes,
    edges: workflow.edges,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }))

  return workflow
}

export async function updateWorkflow(workflowId: string, data: Partial<FirestoreWorkflow>): Promise<void> {
  const db = getFirebaseDb()
  const ref = doc(db, 'workflows', workflowId)
  await updateDoc(ref, sanitizeForFirestore({
    ...data,
    updatedAt: new Date().toISOString()
  }))
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const db = getFirebaseDb()
  await deleteDoc(doc(db, 'workflows', workflowId))
}

export async function saveWorkflowRun(workflowId: string, run: Omit<FirestoreWorkflowRun, 'createdAt'> & { createdAt?: Date }): Promise<FirestoreWorkflowRun> {
  const db = getFirebaseDb()
  const runId = run.id || crypto.randomUUID()
  const now = run.createdAt || new Date()

  const runDoc: FirestoreWorkflowRun = {
    ...run,
    id: runId,
    createdAt: now
  }

  await setDoc(doc(db, 'workflows', workflowId, 'runs', runId), sanitizeForFirestore({
    id: runDoc.id,
    workflowId,
    userId: runDoc.userId,
    status: runDoc.status,
    input: runDoc.input,
    output: runDoc.output,
    logs: runDoc.logs,
    durationMs: runDoc.durationMs,
    createdAt: now.toISOString()
  }))

  return runDoc
}

export async function getWorkflowRuns(workflowId: string): Promise<FirestoreWorkflowRun[]> {
  const db = getFirebaseDb()
  const runsRef = collection(db, 'workflows', workflowId, 'runs')
  const snapshot = await getDocs(runsRef)

  const list: FirestoreWorkflowRun[] = []
  snapshot.forEach((d) => {
    const data = d.data()
    const createdAt = data.createdAt instanceof Timestamp
      ? data.createdAt.toDate()
      : (data.createdAt ? new Date(data.createdAt) : new Date())

    list.push({
      id: d.id,
      workflowId,
      userId: data.userId || '',
      status: data.status || 'completed',
      input: data.input || {},
      output: data.output || {},
      logs: data.logs || [],
      durationMs: data.durationMs || 0,
      createdAt
    })
  })

  return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

// ==================== INTEGRATIONS ====================

export async function getUserIntegrations(userId: string): Promise<FirestoreIntegration[]> {
  const db = getFirebaseDb()
  const ref = collection(db, 'integrations')
  const q = query(ref, where('userId', '==', userId))
  const snapshot = await getDocs(q)

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
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date()
    })
  })

  return list
}

export async function upsertIntegration(
  userId: string,
  integration: Omit<FirestoreIntegration, 'id' | 'updatedAt' | 'userId'> & { id?: string }
): Promise<FirestoreIntegration> {
  const db = getFirebaseDb()
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

  await setDoc(doc(db, 'integrations', docId), sanitizeForFirestore({
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
  const db = getFirebaseDb()
  const docId = `${userId}_${provider}`
  await deleteDoc(doc(db, 'integrations', docId))
}

