import { withPromptCache } from '../server/services/models/promptCache'
import type { ModelMessage } from 'ai'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const msgs: ModelMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'build it' }]

const plain = withPromptCache('google', 'SYS', msgs)
assert(plain.system === 'SYS' && plain.messages === msgs, 'other providers are left exactly as they were')
assert(withPromptCache(null, 'SYS', msgs).messages === msgs, 'an unknown provider is left alone')

const a = withPromptCache('anthropic', 'SYS', msgs)
const sys = a.system as { role: string, content: string, providerOptions: any }
assert(sys.role === 'system' && sys.content === 'SYS' && sys.providerOptions.anthropic.cacheControl.type === 'ephemeral', 'Anthropic: the instructions end at a cache point')
assert((a.messages[2] as any).providerOptions.anthropic.cacheControl.type === 'ephemeral' && !(a.messages[0] as any).providerOptions && !(a.messages[1] as any).providerOptions, 'Anthropic: only the last message carries the second cache point')
assert((msgs[2] as any).providerOptions === undefined, 'the original messages are not changed')
const keep = withPromptCache('anthropic', 'S', [{ role: 'user', content: 'x', providerOptions: { anthropic: { foo: 1 } } } as ModelMessage])
assert((keep.messages[0] as any).providerOptions.anthropic.foo === 1 && (keep.messages[0] as any).providerOptions.anthropic.cacheControl, 'options already on the message are kept')
assert(withPromptCache('anthropic', 'S', []).messages.length === 0, 'no messages is fine')
