import { streamText, tool, isStepCount, simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { withModelFallback } from '../server/utils/modelFallback'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
const textParts = (text: string) => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
]
const toolParts = [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: '{"q":"x"}' },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }
]
const stream = (parts: any[]) => ({ stream: simulateReadableStream({ chunks: parts, chunkDelayInMs: null, initialDelayInMs: null }) })
const quota = () => new Error('You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20')

function setup(models: Record<string, any>, order: string[]) {
  const switches: string[] = []
  const first = order[0]!
  const model = withModelFallback(models[first], {
    modelId: first,
    next: skip => order.find(id => !skip.includes(id)) ?? null,
    make: id => models[id],
    onSwitch: (from, to) => switches.push(`${from}>${to}`)
  })
  return { model, switches }
}
const run = async (model: any, tools: any = {}) => {
  const r = streamText({ model, prompt: 'hi', tools, stopWhen: isStepCount(4), maxRetries: 0, onError: () => {} })
  const errors: unknown[] = []
  let text = ''
  for await (const part of r.stream as any) { if (part.type === 'text-delta') text += part.text; if (part.type === 'error') errors.push(part.error) }
  return { text, errors }
}

// 1. The first model refuses the call outright (a quota error before anything starts).
{
  const a = new MockLanguageModelV4({ doStream: async () => { throw quota() } })
  const b = new MockLanguageModelV4({ doStream: async () => stream(textParts('from b')) })
  const { model, switches } = setup({ a, b }, ['a', 'b'])
  const out = await run(model)
  assert(out.text === 'from b' && out.errors.length === 0, 'a refused call moves to the next model and the answer arrives')
  assert(switches.join() === 'a>b', 'the switch is reported once')
}

// 2. The error arrives as the first part of the stream.
{
  const a = new MockLanguageModelV4({ doStream: async () => stream([{ type: 'stream-start', warnings: [] }, { type: 'error', error: quota() }]) })
  const b = new MockLanguageModelV4({ doStream: async () => stream(textParts('from b')) })
  const { model } = setup({ a, b }, ['a', 'b'])
  const out = await run(model)
  assert(out.text === 'from b' && out.errors.length === 0, 'an error as the first part also moves on')
}

// 3. The model works for the first step (a tool call) and runs out on the second: the next model continues with the tool result.
{
  let calls = 0
  const a = new MockLanguageModelV4({ doStream: async () => { calls++; if (calls === 1) return stream(toolParts); throw quota() } })
  let seen = ''
  const b = new MockLanguageModelV4({ doStream: async (options: any) => { seen = JSON.stringify(options.prompt); return stream(textParts('finished on b')) } })
  const lookup = tool({ description: 'look', inputSchema: z.object({ q: z.string() }), execute: async () => ({ found: 'the-secret-result' }) })
  const { model, switches } = setup({ a, b }, ['a', 'b'])
  const out = await run(model, { lookup })
  assert(out.text === 'finished on b' && out.errors.length === 0, 'running out after a tool step does not end the chat')
  assert(seen.includes('the-secret-result'), 'the next model gets the tool result already gathered')
  assert(switches.join() === 'a>b', 'one switch')
}

// 4. Several models out in a row.
{
  const a = new MockLanguageModelV4({ doStream: async () => { throw quota() } })
  const b = new MockLanguageModelV4({ doStream: async () => { throw new Error('503 UNAVAILABLE: high demand') } })
  const c = new MockLanguageModelV4({ doStream: async () => stream(textParts('from c')) })
  const { model, switches } = setup({ a, b, c }, ['a', 'b', 'c'])
  const out = await run(model)
  assert(out.text === 'from c' && switches.join() === 'a>b,b>c', 'it keeps going down the list')
}

// 5. Nothing left: the original error comes through.
{
  const a = new MockLanguageModelV4({ doStream: async () => { throw quota() } })
  const { model } = setup({ a }, ['a'])
  const out = await run(model)
  assert(out.text === '' && out.errors.length === 1 && /quota/i.test(String((out.errors[0] as any)?.message ?? out.errors[0])), 'with no model left the error is shown')
}

// 6. An ordinary error is not swapped.
{
  const a = new MockLanguageModelV4({ doStream: async () => { throw new Error('Tool call validation failed') } })
  let bCalled = false
  const b = new MockLanguageModelV4({ doStream: async () => { bCalled = true; return stream(textParts('x')) } })
  const { model, switches } = setup({ a, b }, ['a', 'b'])
  const out = await run(model)
  assert(!bCalled && switches.length === 0 && out.errors.length === 1, 'an ordinary error does not switch models')
}

// 7. Once words have been sent, an error is not restarted on another model.
{
  const a = new MockLanguageModelV4({ doStream: async () => stream([{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'half an ans' }, { type: 'error', error: quota() }]) })
  let bCalled = false
  const b = new MockLanguageModelV4({ doStream: async () => { bCalled = true; return stream(textParts('x')) } })
  const { model } = setup({ a, b }, ['a', 'b'])
  const out = await run(model)
  assert(!bCalled && out.text.startsWith('half'), 'a reply that has started is never replayed on another model')
}

// 8. A model with a small allowance gets only the tools the message is about; a big one gets the call unchanged.
{
  const { leanParamsFor } = await import('../server/services/models/focus')
  const names = ['calculator', 'weather', 'web_search', 'web_fetch', 'create_document', 'create_spreadsheet', 'write_file', 'workflow_create', 'integration_execute', 'find_photos']
  const params = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: names.map(name => ({ type: 'function', name })) }
  const lean = leanParamsFor('groq/gpt-oss-120b', params, names, 'write me a proposal as a word document', [])
  const got = lean.tools.map((t: any) => t.name)
  assert(got.includes('create_document') && got.includes('web_search') && !got.includes('workflow_create') && !got.includes('write_file'), 'a small-allowance model gets the tools the message is about and not the rest')
  assert(leanParamsFor('google/gemini-3.5-flash', params, names, 'write me a proposal', []).tools.length === names.length, 'a model with room gets every tool')
  const mid = { ...params, prompt: [...params.prompt, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'workflow_create', input: {} }] }, { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'workflow_create', output: { type: 'json', value: {} } }] }] }
  assert(leanParamsFor('groq/gpt-oss-120b', mid, names, 'write me a proposal', []).tools.some((t: any) => t.name === 'workflow_create'), 'a tool already used in this reply stays described')

  // End to end: the fallback model is really called with the smaller list.
  let seenTools: string[] = []
  const a = new MockLanguageModelV4({ doStream: async () => { throw quota() } })
  const b = new MockLanguageModelV4({ doStream: async (o: any) => { seenTools = (o.tools ?? []).map((t: any) => t.name); return stream(textParts('ok')) } })
  const models: any = { 'google/gemini-3.5-flash': a, 'groq/gpt-oss-120b': b }
  const order = ['google/gemini-3.5-flash', 'groq/gpt-oss-120b']
  const model = withModelFallback(a as any, { modelId: order[0]!, next: skip => order.find(id => !skip.includes(id)) ?? null, make: id => models[id], adapt: (id, p) => leanParamsFor(id, p, ['calculator', 'weather', 'web_search', 'web_fetch', 'workflow_create', 'create_document'], 'what is 12 percent of 80', []) })
  const mk = (name: string) => tool({ description: name, inputSchema: z.object({}), execute: async () => ({}) })
  const tools = { calculator: mk('c'), weather: mk('w'), web_search: mk('s'), web_fetch: mk('f'), workflow_create: mk('wf'), create_document: mk('d') }
  const out = await run(model, tools)
  assert(out.text === 'ok' && seenTools.includes('calculator') && !seenTools.includes('workflow_create') && !seenTools.includes('create_document'), 'the fallback model is called with the smaller tool list')
}
