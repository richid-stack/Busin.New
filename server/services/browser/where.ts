import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { bridgeLive, bridgeStore } from '../bridge/store'
import { BridgeBrowserService } from '../bridge/browserService'
import { BROWSER_USE_CAPABILITY } from '../../../shared/bridgeLive'
import { isOnline } from '../bridge/model'
import { defaultBrowserService, type BrowserService } from './service'

/**
 * Where a person's browser runs: in the cloud (the default; a fresh, empty browser each time) or on their own computer
 * through the Bridge (its own browser profile, so sites they signed in to stay signed in). Their choice, kept with their
 * other settings; it is never decided by the assistant.
 */
export type BrowserWhere = 'cloud' | 'computer'

const SETTINGS = 'user_settings'

export async function getBrowserWhere(db: any, userId: string): Promise<BrowserWhere> {
  const doc = await db.collection(SETTINGS).doc(userId).get()
  return doc.exists && doc.data()?.browserWhere === 'computer' ? 'computer' : 'cloud'
}

export async function setBrowserWhere(db: any, userId: string, where: BrowserWhere): Promise<BrowserWhere> {
  const ref = db.collection(SETTINGS).doc(userId)
  // Other settings in the same record (the email switches) are kept.
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    tx.set(ref, { ...(doc.exists ? doc.data() : {}), userId, browserWhere: where, updatedAt: new Date().toISOString() })
  })
  return where
}

/** Can the person's computer do browser work right now, and if not, why not (in words for the settings page). */
export async function computerBrowserStatus(userId: string, deps: { store?: { listDevices(userId: string): Promise<any[]> }, now?: () => Date } = {}): Promise<{ ready: boolean, name: string | null, note: string }> {
  const devices = await (deps.store ?? bridgeStore()).listDevices(userId)
  const now = (deps.now ?? (() => new Date()))()
  if (!devices.length) return { ready: false, name: null, note: 'No computer is connected yet. Add one on the Computers page.' }
  const capable = devices.filter(d => d.capabilities.includes(BROWSER_USE_CAPABILITY))
  const online = capable.filter(d => isOnline(d, now))
  if (online.length) return { ready: true, name: online[0].name, note: `Ready on “${online[0].name}”.` }
  if (capable.length) return { ready: false, name: capable[0].name, note: `“${capable[0].name}” is offline. Start the Bridge on it.` }
  return { ready: false, name: null, note: 'No computer has allowed this yet. On the computer, run: bridge allow browser_use' }
}

/** The browser service for this person: their computer if they chose it, otherwise the cloud browser (null when the server has none). */
export async function browserServiceFor(userId: string): Promise<BrowserService | null> {
  const where = await getBrowserWhere(getFirebaseDb(), userId).catch(() => 'cloud' as const)
  if (where === 'computer') return new BridgeBrowserService({ store: bridgeStore(), broker: bridgeLive(), userId })
  return defaultBrowserService()
}
