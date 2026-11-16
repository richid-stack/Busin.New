import { modelErrorMessage } from '../server/utils/modelError'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const say = (m: string) => modelErrorMessage(new Error(m))

assert(/too big|big/.test(say('Request too large for model `qwen/qwen3.8-27b` on input tokens per minute (ITPM): Limit 7000, Requested 15296')), 'Groq free-plan size limit says the message is too big, not "wait a moment"')
assert(/busy/.test(say('This model is currently experiencing high demand. Spikes in demand are usually temporary. status: UNAVAILABLE 503')), 'Gemini 503 says busy')
assert(/today/.test(say('You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash')), 'Gemini daily free allowance says today')
assert(/rate limit/.test(say('429 Too Many Requests: rate limit reached')), 'a plain rate limit still says wait a moment')
assert(/Something went wrong/.test(say('socket hang up')), 'anything else stays generic')
assert(/Something went wrong/.test(modelErrorMessage('weird')), 'non-Error values are handled')
