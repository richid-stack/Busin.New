process.env.SECRETS_KEY = 'test-secrets-key-0123456789'
import { createServer } from 'node:http'
import { streamText } from 'ai'
import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { MODEL_PROVIDERS, myModelId, parseMyModelId, providerById } from '../shared/modelProviders'
import { ModelListError, fetchProviderModels, readCompatible } from '../server/services/models/list'
import type { JsonGetter } from '../server/services/models/list'
import { MODEL_LIMITS, ModelConnectionError, defaultEnabled, deleteConnection, getConnection, listConnections, saveConnection, setSelection } from '../server/services/models/store'
import { KEY_PURPOSE, buildMyModel, checkBaseUrl, resolveModel } from '../server/services/models/resolve'
import { viewConnection, viewMine, viewProviders } from '../server/services/models/view'
import { open, seal } from '../server/utils/secretBox'
import { existsSync, readFileSync } from 'node:fs'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e } return null }

const db = createFakeFirestore()
useFirebaseDbForTests(db as any)

// ---- The provider list itself ----
const ids = MODEL_PROVIDERS.map(p => p.id)
assert(new Set(ids).size === ids.length, 'every provider has its own id')
assert(['openai', 'anthropic', 'google', 'openrouter', 'groq', 'mistral', 'deepseek', 'moonshot', 'qwen'].every(id => ids.includes(id)), 'the providers asked for are all there')
assert(MODEL_PROVIDERS.filter(p => !p.custom).every(p => /^https:\/\/[a-z0-9.-]+(\/\S*)?$/.test(p.baseUrl)), 'every built-in address is https')
assert(MODEL_PROVIDERS.every(p => p.keyUrl === '' || p.keyUrl.startsWith('https://')), 'every key page is https')
const brandFiles = (n: string) => existsSync(`src/assets/brands/${n.replace('i-brand-', '')}.svg`)
assert(MODEL_PROVIDERS.filter(p => p.icon.startsWith('i-brand-')).every(p => brandFiles(p.icon)), 'every provider logo exists in the bundled brand set')
assert(readFileSync('src/generated/icons.json', 'utf8').includes('"brand"'), 'the brand collection is part of the generated icons')
assert(parseMyModelId(myModelId('groq', 'openai/gpt-oss-120b'))?.providerId === 'groq' && parseMyModelId(myModelId('groq', 'openai/gpt-oss-120b'))?.model === 'openai/gpt-oss-120b', 'a model id keeps slashes in the model name')
assert(parseMyModelId('google/gemini-3.5-flash') === null && parseMyModelId('my:') === null && parseMyModelId('my:nothing') === null, 'built-in and broken ids are not "my" models')

// ---- Reading each provider's list ----
const fake = (routes: Record<string, { status?: number, json: unknown }>, seen: Array<{ url: string, headers: Record<string, string> }> = []): JsonGetter => async (url, headers) => {
  seen.push({ url, headers })
  const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
  return hit ? { status: hit[1].status ?? 200, json: hit[1].json } : { status: 404, json: null }
}

let seen: Array<{ url: string, headers: Record<string, string> }> = []
let list = await fetchProviderModels(providerById('openai')!, { apiKey: 'sk-test-1234', get: fake({ 'https://api.openai.com/v1/models': { json: { data: [
  { id: 'gpt-5', created: 300 }, { id: 'gpt-5-mini', created: 200 }, { id: 'text-embedding-3-large', created: 500 }, { id: 'whisper-1' }, { id: 'dall-e-3' }, { id: 'gpt-4o-realtime-preview' }, { id: 'o3', created: 400 }
] } } }, seen) })
assert(list.map(m => m.id).join() === 'o3,gpt-5,gpt-5-mini', 'OpenAI: chat models only, newest first (embeddings, speech and image models left out)')
assert(seen[0]!.headers.authorization === 'Bearer sk-test-1234', 'OpenAI: the key goes in the Authorization header')

seen = []
list = await fetchProviderModels(providerById('anthropic')!, { apiKey: 'sk-ant-test', get: fake({
  'https://api.anthropic.com/v1/models?limit=1000&after_id=': { json: { data: [{ id: 'claude-old', display_name: 'Claude Old', created_at: '2025-01-01T00:00:00Z' }], has_more: false } },
  'https://api.anthropic.com/v1/models?limit=1000': { json: { data: [{ id: 'claude-new', display_name: 'Claude New', created_at: '2026-06-01T00:00:00Z' }], has_more: true, last_id: 'claude-new' } }
}, seen) })
assert(list.map(m => m.id).join() === 'claude-new,claude-old' && list[0]!.label === 'Claude New', 'Anthropic: follows the pages and uses the display names')
assert(seen[0]!.headers['x-api-key'] === 'sk-ant-test' && seen[0]!.headers['anthropic-version'] === '2023-06-01' && seen[1]!.url.includes('after_id=claude-new'), 'Anthropic: key and version headers, and the next page is asked for')

seen = []
list = await fetchProviderModels(providerById('google')!, { apiKey: 'AIza-test', get: fake({ 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000': { json: { models: [
  { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', inputTokenLimit: 1000000, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] }
] } } }, seen) })
assert(list.length === 1 && list[0]!.id === 'gemini-3-pro' && list[0]!.context === 1000000, 'Google: only models that can chat, with the "models/" prefix removed')
assert(seen[0]!.headers['x-goog-api-key'] === 'AIza-test', 'Google: the key goes in its own header, not the address')

list = await fetchProviderModels(providerById('openrouter')!, { apiKey: 'sk-or-x', get: fake({ 'https://openrouter.ai/api/v1/models': { json: { data: [
  { id: 'meta/llama-free:free', name: 'Llama Free', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
  { id: 'openai/gpt-image', name: 'Image', architecture: { output_modalities: ['image'] } },
  { id: 'anthropic/claude-x', name: 'Claude X', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools', 'reasoning'], pricing: { prompt: '0.000003', completion: '0.000015' } }
] } } }) })
const free = list.find(m => m.id === 'meta/llama-free:free')!
const paid = list.find(m => m.id === 'anthropic/claude-x')!
assert(list.length === 2 && free.free === true && free.tools === true && free.context === 131072, 'OpenRouter: image-output models dropped; free, tools and context read from what it says')
assert(paid.vision === true && paid.reasoning === true && !paid.free, 'OpenRouter: image input and reasoning are read, paid models are not marked free')

const bare = await fetchProviderModels(providerById('custom')!, { apiKey: 'k-1234567', baseUrl: 'https://gw.example.com/v1/', get: fake({ 'https://gw.example.com/v1/models': { json: [{ id: 'a' }, { id: 'b', type: 'embedding' }, { id: 'c', type: 'chat' }] } }) })
assert(bare.map(m => m.id).sort().join() === 'a,c', 'another service: a bare array works, and a service that labels embeddings is believed')
assert((await fetchProviderModels(providerById('perplexity')!, { apiKey: 'pplx-1234567', get: async () => { throw new Error('should not ask') } })).length === 4, 'Perplexity has no list endpoint: its fixed models are offered without a call')
assert(readCompatible({ id: 'x', capabilities: { completion_chat: false } }) === null, 'a model that says it cannot chat is left out')

// ---- Errors say what to do ----
const statuses: Array<[number, RegExp]> = [[401, /did not accept that key/], [403, /did not accept that key/], [404, /no model list/], [429, /too many requests/], [500, /error 500/]]
for (const [status, re] of statuses) {
  const err = await rejects(() => fetchProviderModels(providerById('groq')!, { apiKey: 'gsk-test-1234', get: fake({ 'https://api.groq.com/openai/v1/models': { status, json: null } }) }))
  assert(err instanceof ModelListError && re.test(err.message), `error ${status} is explained in plain words`)
}
const empty = await rejects(() => fetchProviderModels(providerById('groq')!, { apiKey: 'gsk-test-1234', get: fake({ 'https://api.groq.com/openai/v1/models': { json: { data: [] } } }) }))
assert(empty instanceof ModelListError && /no models/.test(empty.message), 'an empty answer is reported, not saved as "connected"')

// ---- Typed addresses must be public https ----
for (const bad of ['http://api.example.com/v1', 'https://127.0.0.1/v1', 'https://localhost/v1', 'https://169.254.169.254/latest', 'https://10.0.0.5/v1', 'https://user:pw@api.example.com/v1', 'https://api.example.com/v1?key=1', 'not a url']) {
  let threw = false
  try { checkBaseUrl(bad) } catch { threw = true }
  assert(threw, `address refused: ${bad}`)
}
assert(checkBaseUrl('https://93.184.216.34/v1/') === 'https://93.184.216.34/v1', 'a public https address is accepted, trailing slash removed')

// ---- Saving: the key is sealed, limits hold, choices are checked ----
const models = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, label: `Model ${i}`, created: 1000 - i }))
const sealed = seal('sk-very-secret-key', KEY_PURPOSE)
const saved = await saveConnection('alice', { providerId: 'groq', baseUrl: '', sealedKey: sealed, models })
assert(saved.enabled.length === 8 && saved.enabled[0] === 'm0', 'a long list starts with the newest 8 switched on, not everything')
assert(defaultEnabled(models.slice(0, 5)).length === 5, 'a short list starts with all of it on')
const raw = JSON.stringify((await db.collection('model_connections').doc('alice__groq').get()).data())
assert(!raw.includes('sk-very-secret-key') && open(JSON.parse(raw).sealedKey, KEY_PURPOSE) === 'sk-very-secret-key', 'the stored key is encrypted and opens only with its own purpose')
assert((await rejects(async () => open(JSON.parse(raw).sealedKey, 'something-else'))) !== null, 'the key does not open for another purpose')
assert(!JSON.stringify(viewConnection(saved)).includes('sealedKey') && !JSON.stringify(viewConnection(saved)).includes('sk-very-secret-key'), 'what the browser receives never has the key')

const picked = await setSelection('alice', 'groq', { enabled: ['m3', 'm4'], manual: [] })
assert(picked.enabled.join() === 'm3,m4', 'the person picks which models show')
assert((await rejects(() => setSelection('alice', 'groq', { enabled: ['not-a-model'], manual: [] }))) instanceof ModelConnectionError, 'a model the provider never listed cannot be switched on')
const typed = await setSelection('alice', 'groq', { enabled: ['m3', 'my-new-model'], manual: ['my-new-model'] })
assert(typed.enabled.includes('my-new-model') && typed.manual.join() === 'my-new-model', 'a model typed by name can be switched on')
assert((await rejects(() => setSelection('alice', 'groq', { enabled: Array.from({ length: MODEL_LIMITS.enabled + 1 }, (_, i) => `x${i}`), manual: Array.from({ length: MODEL_LIMITS.enabled + 1 }, (_, i) => `x${i}`).slice(0, 20) }))) instanceof ModelConnectionError, 'too many switched on is refused')
assert((await rejects(() => setSelection('bob', 'groq', { enabled: [], manual: [] }))) instanceof ModelConnectionError, 'another person cannot change your selection')

const again = await saveConnection('alice', { providerId: 'groq', baseUrl: '', sealedKey: seal('sk-new-key', KEY_PURPOSE), models: models.slice(0, 20) })
assert(again.enabled.includes('m3') && again.enabled.includes('my-new-model'), 'connecting again keeps your choices for models that still exist')
const gone = await saveConnection('alice', { providerId: 'groq', baseUrl: '', sealedKey: sealed, models: models.slice(5, 20) })
assert(!gone.enabled.includes('m3'), 'a model the provider no longer lists drops out of your choices')
assert((await listConnections('bob')).length === 0, 'you only see your own connections')

// ---- What the picker shows ----
const mine = viewMine(await listConnections('alice'))
assert(mine.every(m => m.value.startsWith('my:groq/') && m.provider === 'Groq') && mine.some(m => m.value === 'my:groq/my-new-model'), 'the picker gets my:<provider>/<model> ids with the provider name')
const rows = viewProviders(await listConnections('alice'))
assert(rows.find(r => r.id === 'groq')!.connected && !rows.find(r => r.id === 'openai')!.connected && rows.length === MODEL_PROVIDERS.length, 'the provider list says which ones are connected')

// ---- Using a model: every gate ----
const noConnection = async () => null
assert((await rejects(() => resolveModel(null, 'my:groq/m6'))) !== null, 'signed-out visitors cannot use someone\'s own model')
assert((await rejects(() => resolveModel('alice', 'my:groq/m6', { getConnection: noConnection }))) !== null, 'a provider you have not connected is refused')
assert((await rejects(() => resolveModel('alice', 'my:groq/not-switched-on'))) !== null, 'a model you have not switched on is refused')
const live = await resolveModel('alice', 'my:groq/my-new-model')
assert(live.own === true && Boolean(live.model), 'a switched-on model resolves and is marked as running on your own key')
const brokenKey = async () => ({ ...(await getConnection('alice', 'groq'))!, sealedKey: 'v1.broken.broken.broken' })
assert((await rejects(() => resolveModel('alice', 'my:groq/m6', { getConnection: brokenKey as any }))) !== null, 'an unreadable saved key is reported')
assert((await resolveModel(null, 'google/gemini-3.5-flash').then(r => r.own).catch(() => 'threw')) !== true, 'built-in models are never marked as your own')

// ---- A real chat round trip against a local OpenAI-style service ----
const seenReq: Array<{ url: string, auth: string, body: any }> = []
const server = createServer((req, res) => {
  let data = ''
  req.on('data', c => (data += c))
  req.on('end', () => {
    seenReq.push({ url: req.url ?? '', auth: String(req.headers.authorization), body: data ? JSON.parse(data) : null })
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'local-chat' }, { id: 'local-embed-text-embedding' }] }))
      return
    }
    res.setHeader('content-type', 'text/event-stream')
    const chunk = (delta: any, finish: string | null = null) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'local-chat', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    res.write(chunk({ role: 'assistant', content: 'Hello ' }))
    res.write(chunk({ content: 'from your own model.' }))
    res.write(chunk({}, 'stop'))
    res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'local-chat', choices: [], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as any).port
const localDef = { ...providerById('groq')!, baseUrl: `http://127.0.0.1:${port}/v1` }
// The real getter only talks to public addresses, which is the point; here a plain fetch reaches the local stand-in.
const plainGet: JsonGetter = async (url, headers) => { const r = await fetch(url, { headers }); return { status: r.status, json: await r.json() } }
const listed = await fetchProviderModels(localDef, { apiKey: 'local-key-123', get: plainGet })
assert(listed.length === 1 && listed[0]!.id === 'local-chat', 'the list is read from a real HTTP service, embeddings left out')
const result = streamText({ model: buildMyModel(localDef, { baseUrl: '' }, 'local-key-123', 'local-chat'), prompt: 'Say hello', onError: () => {} })
const reply = await result.text
assert(reply === 'Hello from your own model.', 'a real streamed reply comes back through the model built from the saved details')
const chat = seenReq.find(r => r.url === '/v1/chat/completions')!
assert(chat.auth === 'Bearer local-key-123' && chat.body.model === 'local-chat' && chat.body.stream === true, 'the request carries the person\'s key and the chosen model')
assert(!('reasoning_format' in chat.body) && !('thinking' in chat.body) && !JSON.stringify(chat.body).includes('reasoning'), 'none of the built-in providers\' special settings leak into a model of your own')
server.close()

// ---- Removing ----
assert(await deleteConnection('alice', 'groq') === true && await getConnection('alice', 'groq') === null, 'removing a provider deletes the key and the list')
assert(await deleteConnection('alice', 'groq') === false, 'removing twice is harmless')
