import { getFirebaseDb } from '../../utils/firebaseAdmin'
import type { ApprovedTool } from './tools'
import type { McpServer } from './server'

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

export async function createServer(userId: string, input: Pick<McpServer, 'name' | 'url' | 'headerName' | 'sealedToken'>): Promise<McpServer> {
  const now = new Date().toISOString()
  const ref = getFirebaseDb().collection(COLLECTION).doc()
  const doc = { ...input, userId, enabled: true, approved: {}, lastError: '', driftNote: '', createdAt: now, updatedAt: now }
  await ref.set(doc)
  return fromDoc(ref.id, doc)
}

/** Only these fields can change after creation; the address is fixed so an approved server cannot be pointed elsewhere. */
export async function updateServer(id: string, patch: Partial<Pick<McpServer, 'name' | 'headerName' | 'sealedToken' | 'enabled' | 'approved' | 'lastError' | 'driftNote'>>): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).update({ ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteServer(id: string): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).delete()
}

export const approvedCount = (servers: McpServer[], exceptId?: string) =>
  servers.filter(s => s.id !== exceptId).reduce((n, s) => n + Object.keys(s.approved).length, 0)
