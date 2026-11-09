import { HTTPError } from 'nitro'
import type { SpeechModel, TranscriptionModel } from 'ai'
import { createElevenLabs } from '@ai-sdk/elevenlabs'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import type { VoiceService } from '../../../shared/voice'
import { open } from '../../utils/secretBox'
import { KEY_PURPOSE } from '../models/resolve'
import { getConnection } from '../models/store'
import { getVoiceKey } from './store'
import { isUnlimited } from '../usage/plans'
import { getPlan } from '../usage/usage'

export const VOICE_KEY_PURPOSE = 'voice-key'

/** The app's own key for a service, used only for people it is allowed for. */
export function appKey(service: VoiceService): string | undefined {
  switch (service) {
    case 'google': return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || undefined
    case 'openai': return process.env.OPENAI_API_KEY || undefined
    case 'groq': return process.env.GROQ_API_KEY || undefined
    case 'elevenlabs': return process.env.ELEVENLABS_API_KEY || undefined
    default: return undefined
  }
}

export interface VoiceKey { key: string, /** Their own key: costs us nothing. */ own: boolean }

export interface KeyDeps {
  getVoiceKey: (userId: string, service: VoiceService) => Promise<string | null>
  getChatKey: (userId: string, service: VoiceService) => Promise<string | null>
  mayUseAppKey: (userId: string) => Promise<boolean>
}

const realDeps: KeyDeps = {
  getVoiceKey,
  // A key saved under Models for chat works for voice too: one OpenAI or Gemini key, many uses.
  getChatKey: async (userId, service) => {
    const connection = await getConnection(userId, service).catch(() => null)
    if (!connection) return null
    try { return open(connection.sealedKey, KEY_PURPOSE) } catch { return null }
  },
  mayUseAppKey: async userId => isUnlimited(userId) || (await getPlan(userId).catch(() => ({ plan: 'free' as const }))).plan === 'pro'
}

/**
 * Which key to use for a service: the one the person saved for voice, else the one they saved for chat, else the
 * app's own when the person is on a paid plan (or is a listed owner). Otherwise nothing, and the page says how to fix it.
 */
export async function resolveVoiceKey(userId: string, service: VoiceService, deps: Partial<KeyDeps> = {}): Promise<VoiceKey> {
  const d = { ...realDeps, ...deps }
  const sealed = await d.getVoiceKey(userId, service)
  if (sealed) {
    try { return { key: open(sealed, VOICE_KEY_PURPOSE), own: true } } catch { throw new HTTPError({ statusCode: 400, statusMessage: `The saved ${service} voice key cannot be read. Save it again in Lobby settings.` }) }
  }
  const chat = await d.getChatKey(userId, service)
  if (chat) return { key: chat, own: true }
  const app = appKey(service)
  if (app && await d.mayUseAppKey(userId)) return { key: app, own: false }
  throw new HTTPError({ statusCode: 402, statusMessage: 'Add a key for this voice service in Lobby settings, or switch to the free browser voice.' })
}

export function buildListenModel(service: VoiceService, model: string, key: string): TranscriptionModel {
  switch (service) {
    case 'google': return createGoogleGenerativeAI({ apiKey: key }).transcription(model)
    case 'openai': return createOpenAI({ apiKey: key }).transcription(model)
    case 'groq': return createGroq({ apiKey: key }).transcription(model)
    // The ElevenLabs package carries its own copy of the SDK's provider types; the shapes are the same.
    case 'elevenlabs': return createElevenLabs({ apiKey: key }).transcription(model) as unknown as TranscriptionModel
    default: throw new HTTPError({ statusCode: 400, statusMessage: 'That service cannot listen.' })
  }
}

export function buildSpeakModel(service: VoiceService, model: string, key: string): SpeechModel {
  switch (service) {
    case 'google': return createGoogleGenerativeAI({ apiKey: key }).speech(model)
    case 'openai': return createOpenAI({ apiKey: key }).speech(model)
    case 'elevenlabs': return createElevenLabs({ apiKey: key }).speech(model) as unknown as SpeechModel
    default: throw new HTTPError({ statusCode: 400, statusMessage: 'That service cannot speak.' })
  }
}
