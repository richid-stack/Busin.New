/**
 * Lobby's voice: which services can listen and speak, what they cost the person, and the settings a person
 * can change. Shared by the server (to build the right model) and the pages (to show the choices).
 *
 * Every service is optional. "browser" is the free one built into the person's own browser and needs nothing
 * from us; it is also what Lobby falls back to when a service fails, so a talk never goes quiet.
 */

export type VoiceService = 'browser' | 'google' | 'openai' | 'groq' | 'elevenlabs'

export interface VoiceChoice { id: string, label: string }

export interface VoiceServiceDef {
  id: VoiceService
  name: string
  icon: string
  /** Where the person makes a key for it. Empty for the browser. */
  keyUrl: string
  keyHelp: string
  /** Models that turn speech into text, first is the default. Empty when it cannot listen. */
  listen: VoiceChoice[]
  /** Models that turn text into speech, first is the default. Empty when it cannot speak. */
  speak: VoiceChoice[]
  voices: VoiceChoice[]
  /** The person may type any voice id (ElevenLabs lets you pick from a large library). */
  customVoice?: boolean
  /** One line on what it is good for. */
  note: string
}

export const VOICE_SERVICES: VoiceServiceDef[] = [
  {
    id: 'browser', name: 'This browser', icon: 'i-lucide-globe', keyUrl: '', keyHelp: '',
    listen: [{ id: 'default', label: 'Browser listening' }], speak: [{ id: 'default', label: 'Browser voice' }],
    voices: [{ id: 'default', label: 'The best voice on this device' }],
    note: 'Free and needs no key. Shows your words as you speak. Chrome and Edge send the audio to their own speech service; the voice itself sounds more robotic.'
  },
  {
    id: 'google', name: 'Google Gemini', icon: 'i-brand-gemini-color', keyUrl: 'https://aistudio.google.com/apikey', keyHelp: 'The same Gemini key you use for chat. It has a free tier.',
    listen: [{ id: 'gemini-3.5-transcribe', label: 'Gemini transcribe' }],
    speak: [{ id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash voice' }, { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash voice' }],
    voices: [{ id: 'Kore', label: 'Kore (firm)' }, { id: 'Puck', label: 'Puck (upbeat)' }, { id: 'Zephyr', label: 'Zephyr (bright)' }, { id: 'Charon', label: 'Charon (informative)' }, { id: 'Leda', label: 'Leda (youthful)' }, { id: 'Aoede', label: 'Aoede (breezy)' }, { id: 'Fenrir', label: 'Fenrir (excitable)' }],
    note: 'Good quality with a free tier. Listening and speaking from one key.'
  },
  {
    id: 'openai', name: 'OpenAI', icon: 'i-brand-openai', keyUrl: 'https://platform.openai.com/api-keys', keyHelp: 'The same OpenAI key you use for chat. Billing is on your OpenAI account.',
    listen: [{ id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini transcribe' }, { id: 'gpt-4o-transcribe', label: 'GPT-4o transcribe' }, { id: 'whisper-1', label: 'Whisper' }],
    speak: [{ id: 'gpt-4o-mini-tts', label: 'GPT-4o mini voice (follows tone instructions)' }, { id: 'tts-1', label: 'TTS-1 (fastest)' }, { id: 'tts-1-hd', label: 'TTS-1 HD' }],
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    note: 'Natural, and the mini voice can be told to sound warm and unhurried.'
  },
  {
    id: 'groq', name: 'Groq', icon: 'i-brand-groq', keyUrl: 'https://console.groq.com/keys', keyHelp: 'The same Groq key you use for chat. It has a free tier.',
    listen: [{ id: 'whisper-large-v3-turbo', label: 'Whisper large v3 turbo' }, { id: 'whisper-large-v3', label: 'Whisper large v3' }], speak: [], voices: [],
    note: 'The quickest listening, with a free tier. It listens only; pick another service to speak.'
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', icon: 'i-lucide-audio-lines', keyUrl: 'https://elevenlabs.io/app/settings/api-keys', keyHelp: 'Create a key in your ElevenLabs account. It has a small free allowance.',
    listen: [{ id: 'scribe_v1', label: 'Scribe' }, { id: 'scribe_v2', label: 'Scribe v2' }],
    speak: [{ id: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' }, { id: 'eleven_multilingual_v2', label: 'Multilingual v2 (richest)' }, { id: 'eleven_v3', label: 'v3 (most expressive)' }],
    voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }, { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' }, { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' }, { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' }, { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni' }, { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' }],
    customVoice: true,
    note: 'The most lifelike voices, and a huge library: paste any voice id to use another.'
  }
]

export const voiceService = (id: string) => VOICE_SERVICES.find(s => s.id === id)

export interface VoiceSettings {
  listen: { service: VoiceService, model: string }
  speak: { service: VoiceService, model: string, voice: string }
  /** After Lobby finishes, listen again by itself. */
  keepListening: boolean
  /** 0.8 slower to 1.3 faster. */
  speed: number
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  listen: { service: 'browser', model: 'default' },
  speak: { service: 'browser', model: 'default', voice: 'default' },
  keepListening: true,
  speed: 1
}

export const VOICE_LIMITS = {
  /** The most text Lobby speaks in one call. A sentence or two. */
  speakChars: 500,
  /** The largest recording sent for listening, in bytes (about a minute of speech). */
  listenBytes: 4_000_000,
  speedMin: 0.8,
  speedMax: 1.3,
  customVoiceMax: 64
}

const pickModel = (list: VoiceChoice[], id: unknown): string => (typeof id === 'string' && list.some(m => m.id === id) ? id : list[0]?.id ?? 'default')

/** Makes any input into settings that are safe to store and use: unknown services, models and voices fall back to the defaults. */
export function normaliseVoiceSettings(input: unknown): VoiceSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const listenSvc = voiceService(String(raw.listen?.service))
  const listen = listenSvc && listenSvc.listen.length ? listenSvc : voiceService('browser')!
  const speakSvc = voiceService(String(raw.speak?.service))
  const speak = speakSvc && speakSvc.speak.length ? speakSvc : voiceService('browser')!
  let voice = typeof raw.speak?.voice === 'string' ? raw.speak.voice.trim() : ''
  const known = speak.voices.some(v => v.id === voice)
  // A typed voice id is kept only for services that allow it, and only if it looks like an id.
  if (!known && !(speak.customVoice && /^[A-Za-z0-9_-]{4,64}$/.test(voice))) voice = speak.voices[0]?.id ?? 'default'
  const speed = typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? Math.min(VOICE_LIMITS.speedMax, Math.max(VOICE_LIMITS.speedMin, raw.speed)) : 1
  return {
    listen: { service: listen.id, model: pickModel(listen.listen, raw.listen?.model) },
    speak: { service: speak.id, model: pickModel(speak.speak, raw.speak?.model), voice },
    keepListening: raw.keepListening === undefined ? DEFAULT_VOICE_SETTINGS.keepListening : raw.keepListening === true,
    speed: Math.round(speed * 100) / 100
  }
}
