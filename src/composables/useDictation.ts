/**
 * Dictation: press the small microphone, say it, and the words land in the message box to read and send. It uses the
 * listening service chosen in Lobby settings: the browser's own, or a recording sent to the chosen transcription service.
 * (Voice mode, the waveform button, is different: there the words are sent as soon as they are said.)
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { browserCanListen, transcribeRecording, VoiceError } from '../utils/lobbyAudio'
import { useVoiceSettings } from './useVoiceSettings'

const join = (base: string, said: string) => (base && said ? `${base.replace(/\s+$/, '')} ${said}` : base || said)

export function useDictation(target: Ref<string>) {
  const voice = useVoiceSettings()
  /** The microphone is open. */
  const listening = ref(false)
  /** A recording is being turned into words. */
  const working = ref(false)
  const error = ref('')

  const canRecord = () => typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
  const supported = computed(() => (voice.settings.value.listen.service === 'browser' ? browserCanListen() : canRecord()))

  let stopNow: (() => void) | null = null

  function withBrowser(base: string) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'en-GH'
    rec.interimResults = true
    rec.continuous = true
    let final = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      target.value = join(base, (final + interim).trim())
    }
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') error.value = 'Allow the microphone for this site to dictate.'
      else if (e.error === 'network') error.value = 'The browser’s listening service could not be reached. Pick another listening service in Lobby settings.'
      else if (e.error === 'audio-capture') error.value = 'No microphone was found.'
    }
    rec.onend = () => { listening.value = false; stopNow = null }
    stopNow = () => { try { rec.stop() } catch { /* already stopped */ } }
    listening.value = true
    try { rec.start() } catch { listening.value = false; stopNow = null }
  }

  async function withRecording(base: string) {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      error.value = 'Allow the microphone for this site to dictate.'
      return
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      listening.value = false
      stopNow = null
      if (!chunks.length) return
      working.value = true
      try {
        const said = await transcribeRecording(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }))
        if (said) target.value = join(base, said)
      } catch (e: any) {
        error.value = e instanceof VoiceError ? e.message : 'Could not make out what was said.'
      } finally {
        working.value = false
      }
    }
    stopNow = () => { if (rec.state !== 'inactive') rec.stop() }
    listening.value = true
    rec.start(250)
  }

  async function toggle() {
    error.value = ''
    if (listening.value) { stopNow?.(); return }
    if (working.value) return
    await voice.load()
    if (!supported.value) { error.value = 'This browser cannot listen. Pick a listening service in Lobby settings.'; return }
    const base = target.value
    if (voice.settings.value.listen.service === 'browser') withBrowser(base)
    else await withRecording(base)
  }

  // Know the chosen listening service early, so the microphone only shows when it can work.
  onMounted(() => { void voice.load() })
  onBeforeUnmount(() => stopNow?.())

  return { listening, working, error, supported, toggle }
}
