/**
 * Lobby: talk to OpenLobs and hear it work. The person speaks, the words go to the chat as an ordinary message, and
 * everything the assistant says while it works is spoken sentence by sentence as it arrives, so a long job sounds like
 * someone telling you what they are doing. A decision that needs approval is asked out loud and answered with a yes
 * or a no. The person can interrupt at any time (tap or space) and it stops mid-sentence.
 *
 * The chat does the work; this only listens, speaks and keeps the state of the conversation. The services used to
 * listen and speak come from the person's voice settings, and the free browser voice is the fallback if one fails.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref, type UnwrapNestedRefs } from 'vue'
import { yesOrNo } from '../../shared/utils/spoken'
import { lobbyParts, newFeedState, newLines, primeFeed } from '../utils/lobbyLines'
import { browserCanListen, fetchSpeech, playUrl, speakInBrowser, transcribeRecording, VoiceError, type Playback } from '../utils/lobbyAudio'
import { useVoiceSettings } from './useVoiceSettings'

export type LobbyState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface LobbyBindings {
  messages: Ref<any[]>
  status: Ref<string>
  send: (text: string) => void
  stop: () => void
  respond: (approvalId: string, approved: boolean) => void
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** The longest a silent (muted) line is held on screen, so captions can still be followed. */
const readingTime = (text: string) => Math.min(2200, 300 + text.length * 40)

export function useLobby(b: LobbyBindings) {
  const voice = useVoiceSettings()
  const open = ref(false)
  const state = ref<LobbyState>('idle')
  /** What the person said, live while they speak. */
  const heard = ref('')
  /** The line being spoken right now. */
  const now = ref('')
  const notice = ref('')
  const muted = ref(false)
  /** 0 to 1, how loud the person is, for the waves. */
  const level = ref(0)

  const busy = () => b.status.value === 'submitted' || b.status.value === 'streaming'
  const parts = computed(() => lobbyParts(b.messages.value))
  /** The action waiting for a yes or a no, if any. */
  const pending = computed(() => {
    const p = [...parts.value].reverse().find(x => x.kind === 'approval' && x.approvalId)
    return p ? { id: p.approvalId!, question: p.phrase } : null
  })

  let feedState = newFeedState()
  const queue: string[] = []
  let playing = false
  let epoch = 0
  let turnOpen = false
  let current: Playback | null = null
  let serverFailed = false
  let cancelListen: (() => void) | null = null
  /** Set while a recording is running: ends it now and sends what was said. */
  let finishNow: (() => void) | null = null
  let unclear = 0
  let silent = 0
  const prefetched = new Map<string, Promise<string>>()

  const serverVoice = () => voice.settings.value.speak.service !== 'browser' && !serverFailed

  // ---------------------------------------------------------------- speaking

  function enqueue(lines: string[]) {
    for (const line of lines) {
      queue.push(line)
    }
    void pump()
  }

  function prefetch(text: string | undefined) {
    if (!text || muted.value || !serverVoice() || prefetched.has(text)) return
    const p = fetchSpeech(text)
    p.catch(() => {})
    prefetched.set(text, p)
  }

  async function say(text: string, mine: number) {
    if (muted.value) { await sleep(readingTime(text)); return }
    if (serverVoice()) {
      try {
        const url = await (prefetched.get(text) ?? fetchSpeech(text))
        prefetched.delete(text)
        if (mine !== epoch) { URL.revokeObjectURL(url); return }
        current = playUrl(url)
        await current.done
        return
      } catch (e: any) {
        prefetched.delete(text)
        if (mine !== epoch) return
        // Never go quiet in the middle of a talk: say so once and carry on with the browser's voice.
        serverFailed = true
        notice.value = `${e instanceof VoiceError ? e.message.replace(/\.$/, '') : 'The voice service failed'}. Using this browser's voice for now.`
      }
    }
    current = speakInBrowser(text, { rate: voice.settings.value.speed, voiceURI: voice.browserVoice.value })
    await current.done
  }

  async function pump() {
    if (playing) return
    playing = true
    const mine = epoch
    try {
      while (queue.length && mine === epoch) {
        const text = queue.shift()!
        state.value = 'speaking'
        now.value = text
        prefetch(queue[0])
        await say(text, mine)
        current = null
      }
    } finally {
      playing = false
    }
    // Interrupted while lines for the next answer were already waiting: carry on with those.
    if (mine !== epoch) { if (queue.length) void pump(); return }
    now.value = ''
    state.value = busy() ? 'thinking' : 'idle'
    settle()
  }

  function stopSpeaking() {
    current?.stop()
    current = null
    for (const p of prefetched.values()) p.then(u => URL.revokeObjectURL(u)).catch(() => {})
    prefetched.clear()
  }

  // ---------------------------------------------------------------- listening

  function stopListening() {
    cancelListen?.()
    cancelListen = null
    level.value = 0
  }

  /** The person's words: either an answer to a question that needs a yes or no, or a new request. */
  function accept(said: string) {
    heard.value = said
    silent = 0
    const waiting = pending.value
    if (waiting) {
      const answer = yesOrNo(said)
      if (answer) {
        unclear = 0
        turnOpen = true
        state.value = 'thinking'
        enqueue([answer === 'yes' ? 'Okay, going ahead.' : "Alright, I won't do it."])
        b.respond(waiting.id, answer === 'yes')
      } else if (++unclear <= 2) {
        enqueue(['Sorry, was that a yes or a no?'])
      } else {
        notice.value = 'Tap Approve or Decline on the screen.'
        state.value = 'idle'
      }
      return
    }
    submit(said)
  }

  function submit(text: string) {
    const said = text.trim()
    if (!said) return
    if (busy()) { b.stop() }
    stopSpeaking()
    epoch++
    queue.length = 0
    heard.value = said
    turnOpen = true
    notice.value = ''
    state.value = 'thinking'
    b.send(said)
  }

  function nothingHeard() {
    state.value = 'idle'
    if (++silent <= 2 && voice.settings.value.keepListening && open.value) { void sleep(250).then(() => { if (open.value && state.value === 'idle' && !playing && !busy()) void listen() }) } else {
      notice.value = "I didn't hear anything. Tap the waveform button when you want to talk."
    }
  }

  async function listen() {
    if (!open.value || state.value === 'listening') return
    stopSpeaking()
    heard.value = ''
    notice.value = notice.value.startsWith('Tap') ? '' : notice.value
    if (voice.settings.value.listen.service === 'browser') listenWithBrowser()
    else await listenByRecording()
  }

  function listenWithBrowser() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      notice.value = "This browser can't listen. Pick a listening service in Lobby settings, or type below."
      state.value = 'idle'
      return
    }
    const rec = new SR()
    rec.lang = 'en-GH'
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    finishNow = null
    let final = ''
    let cancelled = false
    let failed = false
    state.value = 'listening'
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      heard.value = (final + interim).trim()
    }
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { failed = true; notice.value = 'Allow the microphone for this site, then tap the waveform button.' } else if (e.error === 'network') { failed = true; notice.value = "The browser's listening service could not be reached. Pick another listening service in Lobby settings." } else if (e.error === 'audio-capture') { failed = true; notice.value = 'No microphone was found.' }
    }
    rec.onend = () => {
      level.value = 0
      if (cancelled) return
      cancelListen = null
      const said = final.trim()
      if (said) accept(said)
      else if (failed) state.value = 'idle'
      else nothingHeard()
    }
    cancelListen = () => { cancelled = true; try { rec.abort() } catch { /* already stopped */ } }
    try { rec.start() } catch { state.value = 'idle' }
  }

  async function listenByRecording() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      notice.value = 'Allow the microphone for this site, then tap the waveform button.'
      state.value = 'idle'
      return
    }
    if (!open.value) { stream.getTracks().forEach(t => t.stop()); return }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const started = performance.now()
    let spoke = false
    let quietSince = started
    let floor = 0
    let ticks = 0
    let ended = false
    let send = true

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const v of samples) { const d = (v - 128) / 128; sum += d * d }
      const rms = Math.sqrt(sum / samples.length)
      level.value = Math.min(1, rms * 6)
      const t = performance.now()
      // The first moments set how noisy the room is, so a loud stage does not count as speech.
      if (ticks < 5) { floor = Math.max(floor, rms); ticks++; return }
      if (rms > Math.max(0.02, floor * 2.5)) { spoke = true; quietSince = t }
      if (spoke && t - quietSince > 1400) end(true)
      else if (!spoke && t - started > 8000) end(false)
      else if (t - started > 30000) end(true)
    }, 80)

    function end(sendIt: boolean) {
      if (ended) return
      ended = true
      send = sendIt
      clearInterval(timer)
      level.value = 0
      if (rec.state !== 'inactive') rec.stop()
    }

    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      void ctx.close().catch(() => {})
      cancelListen = null
      if (!send) { if (open.value) nothingHeard(); return }
      if (!open.value) return
      state.value = 'thinking'
      heard.value = 'Working out what you said...'
      try {
        const text = await transcribeRecording(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }))
        if (!open.value) return
        if (text) accept(text)
        else { heard.value = ''; nothingHeard() }
      } catch (e: any) {
        heard.value = ''
        notice.value = e instanceof VoiceError ? e.message : 'Could not make out what was said.'
        state.value = 'idle'
      }
    }

    cancelListen = () => { send = false; ended = true; clearInterval(timer); level.value = 0; if (rec.state !== 'inactive') rec.stop() }
    state.value = 'listening'
    rec.start(250)
    // A second tap while listening means "that is all": stop now and send what was said.
    finishNow = () => end(true)
  }

  // ---------------------------------------------------------------- the turn

  /** After a turn: if a decision is waiting, or the person likes it hands-free, listen again. */
  function turnOver() {
    if (!open.value) return
    if (pending.value || voice.settings.value.keepListening) void listen()
    else state.value = 'idle'
  }

  /** Called when speech has drained or the answer has finished: if both are true, the turn is over. */
  function settle() {
    if (!open.value || !turnOpen || busy() || playing || queue.length) return
    turnOpen = false
    turnOver()
  }

  function feed(finished: boolean) {
    if (!open.value) return
    const lines = newLines(parts.value, feedState, finished)
    if (lines.length) enqueue(lines)
  }

  watch(() => b.messages.value, () => feed(!busy()), { deep: true, flush: 'post' })
  watch(() => b.status.value, (next, prev) => {
    if (!open.value) return
    if (next === 'submitted' || next === 'streaming') {
      turnOpen = true
      if (!playing && state.value !== 'listening') state.value = 'thinking'
      return
    }
    if (prev === 'submitted' || prev === 'streaming') {
      feed(true)
      if (next === 'error') enqueue(['Something went wrong on my side. You can try that again.'])
      settle()
    }
  })

  // ---------------------------------------------------------------- what the page calls

  async function show() {
    if (open.value) return
    await voice.load()
    feedState = newFeedState()
    // What is already in the chat is not read out again: Lobby only speaks what happens from here.
    primeFeed(parts.value, feedState)
    serverFailed = false
    unclear = 0
    silent = 0
    notice.value = ''
    heard.value = ''
    now.value = ''
    open.value = true
    void listen()
  }

  function hide() {
    open.value = false
    epoch++
    queue.length = 0
    turnOpen = false
    stopListening()
    stopSpeaking()
    if (busy()) b.stop()
    state.value = 'idle'
    heard.value = ''
    now.value = ''
  }

  /** One gesture for everything: while it listens, send; while it talks or works, interrupt; otherwise listen. */
  function tap() {
    if (state.value === 'listening') {
      if (finishNow) { finishNow(); finishNow = null } else {
        // The browser's own listening ends by itself; a tap just sends what it has so far.
        const text = heard.value.trim()
        stopListening()
        if (text) accept(text)
        else state.value = 'idle'
      }
      return
    }
    if (state.value === 'speaking' || state.value === 'thinking' || busy()) {
      epoch++
      queue.length = 0
      stopSpeaking()
      now.value = ''
      if (busy()) b.stop()
      turnOpen = false
      state.value = 'idle'
    }
    void listen()
  }

  function toggleMute() {
    muted.value = !muted.value
    if (muted.value) { epoch++; stopSpeaking(); queue.length = 0; now.value = ''; if (state.value === 'speaking') state.value = busy() ? 'thinking' : 'idle' }
  }

  /** The buttons on the approval card on the stage. */
  function decide(approved: boolean) {
    const waiting = pending.value
    if (!waiting) return
    stopListening()
    stopSpeaking()
    epoch++
    queue.length = 0
    turnOpen = true
    state.value = 'thinking'
    b.respond(waiting.id, approved)
  }

  /** Stop whatever is being said and forget what was waiting to be said (a typed message is about to replace it). */
  function silence() {
    epoch++
    queue.length = 0
    stopSpeaking()
    now.value = ''
  }

  /** The person started typing: stop listening so the room is not taken for a message, and let them finish. */
  function pause() {
    if (state.value !== 'listening') return
    stopListening()
    state.value = 'idle'
  }

  const supported = computed(() => voice.settings.value.listen.service !== 'browser' || browserCanListen())

  onBeforeUnmount(hide)

  return { open, state, heard, now, notice, muted, level, pending, supported, show, hide, tap, toggleMute, decide, pause, silence }
}

/** What the stage screen is given: the controller with its refs unwrapped (wrap it in `reactive`). */
export type LobbyController = UnwrapNestedRefs<ReturnType<typeof useLobby>>
