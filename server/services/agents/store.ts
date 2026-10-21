import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import { DEFAULT_GROUPS, DEFAULT_STEPS, agentInputSchema } from './profile'
import type { Agent, AgentInput } from './profile'

const COLLECTION = 'agents'

export function agentFromDoc(id: string, data: Record<string, any>): Agent {
  // Older or hand-edited documents are read through the same rules as new ones, falling back to safe values.
  const parsed = agentInputSchema.safeParse({
    name: data.name || 'Agent',
    description: data.description || '',
    instructions: data.instructions || 'Help the user.',
    model: data.model ?? null,
    tools: Array.isArray(data.tools) ? data.tools : DEFAULT_GROUPS,
    skills: Array.isArray(data.skills) ? data.skills : [],
    maxSteps: data.maxSteps ?? DEFAULT_STEPS
  })
  const input: AgentInput = parsed.success ? parsed.data : agentInputSchema.parse({ name: 'Agent', instructions: 'Help the user.' })
  return { ...input, id, userId: String(data.userId || ''), createdAt: String(data.createdAt || ''), updatedAt: String(data.updatedAt || '') }
}

export async function listAgents(userId: string): Promise<Agent[]> {
  const snap = await getFirebaseDb().collection(COLLECTION).where('userId', '==', userId).get()
  return snap.docs.map(d => agentFromDoc(d.id, d.data())).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getAgent(id: string): Promise<Agent | null> {
  const doc = await getFirebaseDb().collection(COLLECTION).doc(id).get()
  return doc.exists ? agentFromDoc(doc.id, doc.data()!) : null
}

export async function createAgent(userId: string, input: AgentInput): Promise<Agent> {
  await assertNotDeleting(userId)
  const now = new Date().toISOString()
  const ref = getFirebaseDb().collection(COLLECTION).doc()
  const doc = { ...input, userId, createdAt: now, updatedAt: now }
  await ref.set(doc)
  return agentFromDoc(ref.id, doc)
}

export async function updateAgent(id: string, input: AgentInput): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).update({ ...input, updatedAt: new Date().toISOString() })
}

export async function deleteAgent(id: string): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).delete()
}
