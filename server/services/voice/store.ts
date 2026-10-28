import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import { DEFAULT_VOICE_SETTINGS, normaliseVoiceSettings } from '../../../shared/voice'
import type { VoiceService, VoiceSettings } from '../../../shared/voice'

const SETTINGS = 'voice_settings'
const KEYS = 'voice_keys'

/** Services that need a key of their own. The browser needs none; Google, OpenAI and Groq may use the key the person saved for chat. */
export const KEYED_SERVICES: VoiceService[] = ['google', 'openai', 'groq', 'elevenlabs']

export const keyDocId = (userId: string, service: VoiceService) => `${userId}__${service}`

export async function getVoiceSettings(userId: string): Promise<VoiceSettings> {
  const snap = await getFirebaseDb().collection(SETTINGS).doc(userId).get()
  return snap.exists ? normaliseVoiceSettings(snap.data()) : { ...DEFAULT_VOICE_SETTINGS }
}

export async function saveVoiceSettings(userId: string, input: unknown): Promise<VoiceSettings> {
  await assertNotDeleting(userId)
  const settings = normaliseVoiceSettings(input)
  await getFirebaseDb().collection(SETTINGS).doc(userId).set({ ...settings, updatedAt: new Date().toISOString() })
  return settings
}

/** The sealed key a person saved just for voice, or null. Never leaves the server. */
export async function getVoiceKey(userId: string, service: VoiceService): Promise<string | null> {
  const snap = await getFirebaseDb().collection(KEYS).doc(keyDocId(userId, service)).get()
  return snap.exists && snap.data()!.userId === userId ? String(snap.data()!.sealedKey || '') || null : null
}

/** Which services have a voice key saved, with the last four characters so a person can tell which one it is. */
export async function listVoiceKeys(userId: string): Promise<Array<{ service: VoiceService, last4: string, savedAt: string }>> {
  const snap = await getFirebaseDb().collection(KEYS).where('userId', '==', userId).get()
  return snap.docs.map((d: any) => ({ service: d.data().service as VoiceService, last4: String(d.data().last4 || ''), savedAt: String(d.data().savedAt || '') }))
}

export async function saveVoiceKey(userId: string, service: VoiceService, sealedKey: string, last4: string): Promise<void> {
  await assertNotDeleting(userId)
  await getFirebaseDb().collection(KEYS).doc(keyDocId(userId, service)).set({ userId, service, sealedKey, last4, savedAt: new Date().toISOString() })
}

export async function deleteVoiceKey(userId: string, service: VoiceService): Promise<boolean> {
  const ref = getFirebaseDb().collection(KEYS).doc(keyDocId(userId, service))
  const snap = await ref.get()
  if (!snap.exists || snap.data()!.userId !== userId) return false
  await ref.delete()
  return true
}
