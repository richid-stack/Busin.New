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

/** `level` is how loud it is right now, 0 to 1 (real for audio files, word by word for the browser's voice). */
export interface Playback { done: Promise<void>, stop: () => void, level?: () => number }

/** A real loudness reading of an audio element. Skipped (null) unless the audio context is already running, so sound is never put at risk. */
function meterOf(el: HTMLAudioElement): { level: () => number, close: () => void } | null {
  try {
    const ctx = new AudioContext()
    if (ctx.state !== 'running') { void ctx.close(); return null }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    const source = ctx.createMediaElementSource(el)
    source.connect(analyser)
    analyser.connect(ctx.destination)
    const samples = new Uint8Array(analyser.fftSize)
    return {
      level: () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const v of samples) { const d = (v - 128) / 128; sum += d * d }
        return Math.min(1, Math.sqrt(sum / samples.length) * 5)
      },
      close: () => { void ctx.close().catch(() => {}) }
    }
  } catch { return null }
}

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

/**
 * How loud the person is, read from the microphone, so the mark and the waves show whether they are really being heard.
 * Best effort: on devices that cannot share the microphone with the browser's own listening it returns a no-op.
 */
export async function openInputMeter(onLevel: (level: number) => void): Promise<() => void> {
  const none = () => {}
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || /iPad|iPhone|iPod/.test(navigator.userAgent)) return none
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const v of samples) { const d = (v - 128) / 128; sum += d * d }
      onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6))
    }, 80)
    return () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); void ctx.close().catch(() => {}) }
  } catch { return none }
}

export function playUrl(url: string): Playback {
  const el = new Audio(url)
  const meter = meterOf(el)
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve
    el.onended = () => resolve()
    el.onerror = () => reject(new VoiceError('The audio could not be played.'))
    el.play().catch(() => reject(new VoiceError('The browser would not play the audio. Tap the screen once and try again.')))
  }).finally(() => { URL.revokeObjectURL(url); meter?.close() })
  return { done, stop: () => { el.pause(); finish() }, level: meter?.level }
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
  // The browser reports no loudness, but it does say when each word starts: pulse on those.
  let lastWord = 0
  utterance.onboundary = () => { lastWord = performance.now() }
  const started = performance.now()
  const level = () => {
    const now = performance.now()
    if (!lastWord) return now - started > 700 ? 0.4 : 0.15
    return Math.max(0.08, 0.75 * (1 - Math.min(1, (now - lastWord) / 320)))
  }
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    synth.speak(utterance)
  })
  return { done, stop: () => { synth.cancel(); finish() }, level }
}
