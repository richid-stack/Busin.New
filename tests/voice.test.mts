import { DEFAULT_VOICE_SETTINGS, VOICE_LIMITS, VOICE_SERVICES, normaliseVoiceSettings } from '../shared/voice'
import { spokenText, takeSentences, yesOrNo } from '../shared/utils/spoken'
import { VOICE_KEY_PURPOSE, resolveVoiceKey } from '../server/services/voice/resolve'
import { listenFor, speakFor, voiceFailure } from '../server/services/voice/speech'
import { VOICE_PROMPT } from '../server/services/voice/persona'
import { seal } from '../server/utils/secretBox'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as any } return null }

// ---- Settings ----
assert(JSON.stringify(normaliseVoiceSettings(undefined)) === JSON.stringify(DEFAULT_VOICE_SETTINGS), 'nothing chosen gives the free browser voice')
const s1 = normaliseVoiceSettings({ listen: { service: 'groq', model: 'whisper-large-v3-turbo' }, speak: { service: 'elevenlabs', model: 'eleven_flash_v2_5', voice: 'pNInz6obpgDQGcFmaJgB' }, keepListening: false, speed: 1.1 })
assert(s1.listen.service === 'groq' && s1.speak.service === 'elevenlabs' && s1.speak.voice === 'pNInz6obpgDQGcFmaJgB' && s1.keepListening === false && s1.speed === 1.1, 'good choices are kept')
const s2 = normaliseVoiceSettings({ listen: { service: 'nope', model: 'x' }, speak: { service: 'groq', model: 'y', voice: 'z' }, speed: 9 })
assert(s2.listen.service === 'browser' && s2.speak.service === 'browser' && s2.speed === 1.3, 'unknown services, or one that cannot speak, fall back to the browser; speed is held in range')
const s3 = normaliseVoiceSettings({ speak: { service: 'openai', model: 'tts-1', voice: 'made-up' } })
assert(s3.speak.voice === 'alloy' && s3.speak.model === 'tts-1', 'a voice a service does not have becomes its first one')
assert(normaliseVoiceSettings({ speak: { service: 'elevenlabs', voice: 'MyClonedVoice123' } }).speak.voice === 'MyClonedVoice123', 'ElevenLabs accepts a typed voice id')
assert(normaliseVoiceSettings({ speak: { service: 'elevenlabs', voice: 'bad id!!' } }).speak.voice === '21m00Tcm4TlvDq8ikWAM' && normaliseVoiceSettings({ speak: { service: 'openai', voice: 'MyClonedVoice123' } }).speak.voice === 'alloy', 'a typed id must look like one, and only where it is allowed')
assert(VOICE_SERVICES.every(s => s.listen.length || s.speak.length), 'every service can do something')

// ---- What is spoken ----
assert(spokenText('**Done.** I made the [invoice](https://x.com/a?b=1) for GH₵250.50 & sent it.') === 'Done. I made the invoice for 250.50 cedis and sent it.', 'markdown, links and money become words')
assert(spokenText('Here:\n```js\nconsole.log(1)\n```\nAll good.') === 'Here: All good.', 'code is never read out')
assert(spokenText('| a | b |\n|---|---|\n| 1 | 2 |\nThree rows.') === 'Three rows.', 'tables are not read out')
assert(spokenText('Visit https://paystack.com/docs now') === 'Visit a link now', 'a bare link becomes "a link"')
assert(spokenText(`Key is sk-${'a1B2c3D4'.repeat(4)} ok`) === 'Key is a secret value ok' && !spokenText(`token ${'x9'.repeat(25)}`).includes('x9x9'), 'keys and long tokens are never spoken')
assert(spokenText('- first\n- second\n\n# Title') === 'first. second. Title', 'lists and headings are said plainly')
assert(spokenText('😀 Great 🎉 job') === 'Great job' && spokenText('') === '' && spokenText('   \n ') === '', 'emoji and empty text')
assert(spokenText('Growth is 12% & rising') === 'Growth is 12 percent and rising', 'percent and ampersand')

// ---- Sentences from a growing text ----
let r = takeSentences('Let me check. Found thr', 0, false)
assert(r.sentences.join('|') === 'Let me check.' && r.next === 13, 'only complete sentences come out while text is still arriving')
r = takeSentences('Let me check. Found three. Now', r.next, false)
assert(r.sentences.join('|') === 'Found three.', 'the next call carries on from where it stopped')
r = takeSentences('Let me check. Found three. Now drafting', r.next, true)
assert(r.sentences.join('|') === 'Now drafting' && r.next === 'Let me check. Found three. Now drafting'.length, 'the end of the text releases what is left')
assert(takeSentences('Ask Dr. Mensah about 2.5 percent. Thanks.', 0, true).sentences.join('|') === 'Ask Dr. Mensah about 2.5 percent.|Thanks.', 'abbreviations and decimals do not end a sentence')
assert(takeSentences('One!\nTwo? Three...', 0, true).sentences.join('|') === 'One!|Two?|Three.', 'line breaks and other endings')

assert(takeSentences('Here you go.\n```js\nx()\n```\nDone. ', 0, true).sentences.join('|') === 'Here you go.|Done.', 'a code block is never split into spoken lines')
assert(takeSentences('Here.\n```js\nx()\ny()', 0, false).sentences.join('|') === 'Here.' && takeSentences('Here.\n```js\nx()\ny()', 0, false).next === 6, 'an unfinished code block waits')

// ---- Yes or no ----
for (const t of ['Yes', 'yeah go ahead', 'Okay, do it.', 'sure', 'approve it']) assert(yesOrNo(t) === 'yes', `"${t}" is a yes`)
for (const t of ['No', 'nope', "don't send it", 'stop', 'cancel that', 'hold on']) assert(yesOrNo(t) === 'no', `"${t}" is a no`)
for (const t of ['', 'maybe', 'what does it say', 'no wait yes go ahead', "yes but don't send the second one", 'tell me more about the invoice and then we can decide what to do about it later']) assert(yesOrNo(t) === null, `"${t}" is neither, so Lobby asks again`)

// ---- Keys: whose key is used ----
const own = seal('SEALED-OWN-KEY-12345', VOICE_KEY_PURPOSE)
const none = async () => null
const k1 = await resolveVoiceKey('u', 'openai', { getVoiceKey: async () => own, getChatKey: async () => 'chat-key-aaaaaaaa', mayUseAppKey: async () => true })
assert(k1.key === 'SEALED-OWN-KEY-12345' && k1.own, 'a key saved for voice comes first')
const k2 = await resolveVoiceKey('u', 'openai', { getVoiceKey: none, getChatKey: async () => 'chat-key-aaaaaaaa', mayUseAppKey: async () => false })
assert(k2.key === 'chat-key-aaaaaaaa' && k2.own, 'then the key saved for chat models')
process.env.OPENAI_API_KEY = 'app-key-bbbbbbbb'
const k3 = await resolveVoiceKey('u', 'openai', { getVoiceKey: none, getChatKey: none, mayUseAppKey: async () => true })
assert(k3.key === 'app-key-bbbbbbbb' && !k3.own, 'then the app key, for people it is allowed for')
const e1 = await rejects(() => resolveVoiceKey('u', 'openai', { getVoiceKey: none, getChatKey: none, mayUseAppKey: async () => false }))
assert(e1?.statusCode === 402 && /Lobby settings/.test(e1.statusMessage), 'otherwise a clear "add a key" message')
delete process.env.ELEVENLABS_API_KEY
assert((await rejects(() => resolveVoiceKey('u', 'elevenlabs', { getVoiceKey: none, getChatKey: none, mayUseAppKey: async () => true })))?.statusCode === 402, 'no app key set means no free ride either')
assert((await rejects(() => resolveVoiceKey('u', 'openai', { getVoiceKey: async () => 'v1.garbage.garbage.garbage', getChatKey: none, mayUseAppKey: none as any })))?.statusCode === 400, 'a stored key that cannot be read says so')

// ---- Speaking and listening, with the provider swapped out ----
const calls: any[] = []
const speakSettings = (service: string, model: string, voice = 'v') => async () => normaliseVoiceSettings({ speak: { service, model, voice }, speed: 1.2 })
const deps = (over: any = {}) => ({
  settings: speakSettings('openai', 'gpt-4o-mini-tts', 'coral'),
  key: async () => ({ key: 'k', own: true }),
  speakModel: (s: string, m: string, k: string) => ({ s, m, k }) as any,
  listenModel: (s: string, m: string) => ({ s, m }) as any,
  generate: (async (o: any) => { calls.push(o); return { audio: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' } } }) as any,
  transcribe: (async (o: any) => { calls.push(o); return { text: '  hello   there ' } }) as any,
  ...over
})
const spoken = await speakFor('u', '**Hello** there. See https://x.com', { deps: deps() })
assert(spoken.audio.length === 3 && calls[0].text === 'Hello there. See a link' && calls[0].voice === 'coral' && calls[0].speed === 1.2 && /warm/.test(calls[0].instructions), 'speech is made from the speakable text, in the chosen voice, speed and tone')
calls.length = 0
await speakFor('u', 'Hi', { deps: deps({ settings: speakSettings('elevenlabs', 'eleven_flash_v2_5') }) })
assert(calls[0].instructions === undefined, 'tone instructions go only to services that read them')
calls.length = 0
await speakFor('u', 'word '.repeat(400), { deps: deps() })
assert(calls[0].text.length === VOICE_LIMITS.speakChars, 'one call never speaks more than a couple of sentences')
assert((await rejects(() => speakFor('u', 'Hi', { deps: deps({ settings: async () => DEFAULT_VOICE_SETTINGS }) })))?.statusCode === 400, 'the browser voice is spoken on the device, not by the server')
assert((await rejects(() => speakFor('u', '```code```', { deps: deps() })))?.statusMessage === 'Nothing to say.', 'text with nothing speakable is refused')
const failing = deps({ generate: async () => { throw Object.assign(new Error('Incorrect API key provided'), { statusCode: 401 }) } })
assert((await rejects(() => speakFor('u', 'Hi', { deps: failing })))?.statusCode === 400, 'a provider that rejects the key gives a "check your key" message')
assert(voiceFailure(Object.assign(new Error('rate limit'), { statusCode: 429 }), 'openai').statusCode === 429 && voiceFailure(new Error('boom'), 'openai').statusCode === 502, 'rate limits and other failures are told apart')
assert(!/sk-|boom/.test(voiceFailure(new Error('boom sk-secret'), 'openai').statusMessage ?? ''), 'a provider error never leaks into the message')

calls.length = 0
const heard = await listenFor('u', new Uint8Array([1, 2, 3]), { deps: deps({ settings: async () => normaliseVoiceSettings({ listen: { service: 'groq', model: 'whisper-large-v3-turbo' } }) }) })
assert(heard.text === 'hello there' && calls[0].model.s === 'groq', 'what is heard is tidied, using the chosen service')
assert((await rejects(() => listenFor('u', new Uint8Array(), { deps: deps() })))?.statusCode === 400 && (await rejects(() => listenFor('u', new Uint8Array(VOICE_LIMITS.listenBytes + 1), { deps: deps({ settings: async () => normaliseVoiceSettings({ listen: { service: 'groq' } }) }) })))?.statusCode === 413, 'empty and over-long recordings are refused')
assert((await rejects(() => listenFor('u', new Uint8Array([1]), { deps: deps({ settings: async () => DEFAULT_VOICE_SETTINGS }) })))?.statusCode === 400, 'browser listening happens on the device')

// ---- What the assistant is told ----
assert(/NARRATE/.test(VOICE_PROMPT) && /yes or no|OK before/.test(VOICE_PROMPT) && /Never read out a key/.test(VOICE_PROMPT) && /cedis/.test(VOICE_PROMPT), 'voice mode tells it to narrate, ask before changing things, and keep secrets off the air')
console.log(process.exitCode ? 'Voice tests FAILED' : 'Voice tests OK')
