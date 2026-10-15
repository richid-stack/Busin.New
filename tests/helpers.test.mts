import { interpolateVariables, interpolateDeep, snapshotContext } from '../server/utils/workflowEngine'
import { normalizeModelId, pickAvailableModel, providerOf } from '../server/utils/models'

const assert = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const ctx = { trigger: { email: { subject: 'Hi' } }, 'ai-triage': { result: 'High' }, list: [1, 2] }
assert(interpolateVariables('Subject: {{trigger.email.subject}}', ctx) === 'Subject: Hi', 'interpolates nested paths')
assert(interpolateVariables('{{ ai-triage.result }}', ctx) === 'High', 'node ids with dashes and spaces in braces')
assert(interpolateVariables('{{nope.x}}', ctx) === '[nope.x]', 'unknown path stays visible')
assert(interpolateVariables('{{list}}', ctx) === '[1,2]', 'non-strings are JSON encoded')
assert(JSON.stringify(interpolateDeep({ a: ['{{ai-triage.result}}'], b: { c: 5 } }, ctx)) === '{"a":["High"],"b":{"c":5}}', 'interpolateDeep walks objects/arrays')

const circular: any = { a: 1 }; circular.self = circular
assert(snapshotContext(circular).unserialisable === true, 'snapshotContext survives circular input')
assert(snapshotContext({ x: 'y'.repeat(100) }, 10).truncated === true, 'snapshotContext truncates large input')

assert(normalizeModelId('google/gemini-2.5-flash') === 'google/gemini-3.5-flash', 'retired model remapped')
assert(normalizeModelId('groq/llama-3.1-70b-versatile') === 'google/gemini-3.5-flash', 'retired llama remapped')
assert(providerOf('openai/gpt-5-nano') === 'openai' && providerOf('nope/x') === null, 'providerOf')

for (const k of ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k]
assert(pickAvailableModel('google/gemini-3.5-flash') === null, 'no keys -> no model')
process.env.GROQ_API_KEY = 'x'
assert(pickAvailableModel('google/gemini-3.5-flash') === 'groq/gpt-oss-120b', 'falls back to a provider that has a key')
process.env.GEMINI_API_KEY = 'x'
assert(pickAvailableModel('google/gemini-3.5-flash') === 'google/gemini-3.5-flash', 'keeps preferred model when its key exists')
