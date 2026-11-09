import { HTTPError } from 'nitro'
import { generateSpeech, transcribe } from 'ai'
import type { SpeechModel, TranscriptionModel } from 'ai'
import { VOICE_LIMITS, voiceService } from '../../../shared/voice'
import type { VoiceService } from '../../../shared/voice'
import { spokenText } from '../../../shared/utils/spoken'
import { buildListenModel, buildSpeakModel, resolveVoiceKey } from './resolve'
import type { VoiceKey } from './resolve'
import { getVoiceSettings } from './store'
import type { VoiceSettings } from '../../../shared/voice'

/** How Lobby should sound, for services that take instructions (OpenAI's mini voice does). */
export const TONE = 'Speak like a warm, friendly person working alongside the listener: relaxed, clear and a little upbeat, at an unhurried pace. Not like a news reader or a call-centre script.'

export interface VoiceDeps {
  settings: (userId: string) => Promise<VoiceSettings>
  key: (userId: string, service: VoiceService) => Promise<VoiceKey>
  speakModel: (service: VoiceService, model: string, key: string) => SpeechModel
  listenModel: (service: VoiceService, model: string, key: string) => TranscriptionModel
  generate: typeof generateSpeech
  transcribe: typeof transcribe
}

const realDeps: VoiceDeps = {
  settings: getVoiceSettings,
  key: (userId, service) => resolveVoiceKey(userId, service),
  speakModel: buildSpeakModel,
  listenModel: buildListenModel,
  generate: generateSpeech,
  transcribe
}

/** A provider's own words about what went wrong, turned into something a person can act on. */
export function voiceFailure(err: unknown, service: VoiceService): HTTPError {
  if (err instanceof HTTPError) return err
  const message = err instanceof Error ? err.message : String(err)
  const status = Number((err as any)?.statusCode ?? (err as any)?.status ?? 0)
  const name = voiceService(service)?.name ?? service
  console.warn(`[voice] ${service} failed:`, message.slice(0, 300))
  if (status === 401 || status === 403 || /api key|unauthor|invalid.*key/i.test(message)) return new HTTPError({ statusCode: 400, statusMessage: `${name} did not accept the key. Check it in Lobby settings.` })
  if (status === 429 || /quota|rate.?limit|too many/i.test(message)) return new HTTPError({ statusCode: 429, statusMessage: `${name} says too many requests right now.` })
  return new HTTPError({ statusCode: 502, statusMessage: `${name} could not do that just now.` })
}

/** Speech for one short piece of text, in the voice the person chose. */
export async function speakFor(userId: string, rawText: string, opts: { signal?: AbortSignal, deps?: Partial<VoiceDeps> } = {}): Promise<{ audio: Uint8Array, mediaType: string }> {
  const d = { ...realDeps, ...opts.deps }
  const settings = await d.settings(userId)
  const { service, model, voice } = settings.speak
  if (service === 'browser') throw new HTTPError({ statusCode: 400, statusMessage: 'The browser voice is spoken on your device, not by us.' })
  const text = spokenText(rawText).slice(0, VOICE_LIMITS.speakChars)
  if (!text) throw new HTTPError({ statusCode: 400, statusMessage: 'Nothing to say.' })
  const { key } = await d.key(userId, service)
  try {
    const out = await d.generate({
      model: d.speakModel(service, model, key),
      text,
      voice,
      speed: settings.speed,
      // Only some services read tone instructions; the others ignore it.
      ...(service === 'openai' && model.startsWith('gpt-4o') ? { instructions: TONE } : {}),
      outputFormat: 'mp3',
      maxRetries: 1,
      abortSignal: opts.signal ?? AbortSignal.timeout(20_000)
    })
    return { audio: out.audio.uint8Array, mediaType: out.audio.mediaType || 'audio/mpeg' }
  } catch (err) {
    throw voiceFailure(err, service)
  }
}

/** What was said in a recording, using the service the person chose to listen with. */
export async function listenFor(userId: string, audio: Uint8Array, opts: { signal?: AbortSignal, deps?: Partial<VoiceDeps> } = {}): Promise<{ text: string }> {
  const d = { ...realDeps, ...opts.deps }
  const settings = await d.settings(userId)
  const { service, model } = settings.listen
  if (service === 'browser') throw new HTTPError({ statusCode: 400, statusMessage: 'Browser listening happens on your device, not by us.' })
  if (!audio.byteLength) throw new HTTPError({ statusCode: 400, statusMessage: 'That recording is empty.' })
  if (audio.byteLength > VOICE_LIMITS.listenBytes) throw new HTTPError({ statusCode: 413, statusMessage: 'That recording is too long. Say a little less at a time.' })
  const { key } = await d.key(userId, service)
  try {
    const out = await d.transcribe({ model: d.listenModel(service, model, key), audio, maxRetries: 1, abortSignal: opts.signal ?? AbortSignal.timeout(30_000) })
    return { text: out.text.replace(/\s+/g, ' ').trim() }
  } catch (err) {
    throw voiceFailure(err, service)
  }
}
