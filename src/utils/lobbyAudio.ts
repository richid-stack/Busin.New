/**
 * The sound side of Lobby: fetching spoken audio from the server, playing it or speaking with the browser's own voice,
 * and sending a recording to be turned into words. Each playback can be stopped at any moment, which is what lets a
 * person interrupt Lobby mid-sentence.
 */
import { useCsrf } from '../composables/useCsrf'
import { pickBrowserVoice } from './browserVoice'

export class VoiceError extends Error {
  status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

export interface Playback { done: Promise<void>, stop: () => void }

async function failure(res: Response, fallback: string): Promise<VoiceError> {
  let message = fallback
  try {
    const body = await res.json()
    message = String(body?.statusMessage || body?.statusText || body?.message || fallback)
  } catch { /* the body was not JSON */ }
  return new VoiceError(message, res.status)
}

/** Spoken audio for a sentence, as an object URL (revoke it when done). Uses the person's chosen service and voice. */
export async function fetchSpeech(text: string, signal?: AbortSignal): Promise<string> {
  const { csrf, headerName } = useCsrf()
  const res = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', [headerName]: csrf() }, body: JSON.stringify({ text }), signal })
  if (!res.ok) throw await failure(res, 'The voice service did not answer.')
  return URL.createObjectURL(await res.blob())
}

/** A recording in, the words said out. */
export async function transcribeRecording(blob: Blob, signal?: AbortSignal): Promise<string> {
  const { csrf, headerName } = useCsrf()
  const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream', [headerName]: csrf() }, body: blob, signal })
  if (!res.ok) throw await failure(res, 'Could not make out what was said.')
  const body = await res.json()
  return String(body?.text ?? '').trim()
}

export function playUrl(url: string): Playback {
  const el = new Audio(url)
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve
    el.onended = () => resolve()
    el.onerror = () => reject(new VoiceError('The audio could not be played.'))
    el.play().catch(() => reject(new VoiceError('The browser would not play the audio. Tap the screen once and try again.')))
  }).finally(() => URL.revokeObjectURL(url))
  return { done, stop: () => { el.pause(); finish() } }
}

export const browserCanSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window
export const browserCanListen = () => typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

export function speakInBrowser(text: string, opts: { rate?: number, voiceURI?: string } = {}): Playback {
  if (!browserCanSpeak()) return { done: Promise.resolve(), stop: () => {} }
  const synth = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = opts.rate ?? 1
  const voice = pickBrowserVoice(synth.getVoices(), opts.voiceURI ?? '')
  try {
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang } else utterance.lang = 'en-GB'
  } catch { utterance.lang = 'en-GB' }
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    synth.speak(utterance)
  })
  return { done, stop: () => { synth.cancel(); finish() } }
}
