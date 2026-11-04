/**
 * The model's words in a filmed chat. A scripted model stands in for the provider: it "decides" to use the
 * calculator and the plan tool, and the app's real tools then run and the real chat page draws them. Only the
 * words the model says are scripted; the tools, the trace, the streaming and the page are the app's own.
 */
import { MockLanguageModelV4 } from 'ai/test'

const usage = { inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 80, text: 80, reasoning: 0 } }
const finish = (unified: 'stop' | 'tool-calls') => ({ type: 'finish', usage, finishReason: { unified, raw: unified } }) as any

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
function timed(parts: Array<{ part: any, after: number }>): ReadableStream<any> {
  let i = 0
  return new ReadableStream({
    async pull(c) {
      if (i >= parts.length) { c.close(); return }
      const { part, after } = parts[i++]!
      await wait(after)
      c.enqueue(part)
    }
  })
}
const words = (id: string, text: string, gap = 22) => [
  { part: { type: 'text-start', id }, after: 0 },
  ...text.split(/(?<= )/).map(w => ({ part: { type: 'text-delta', id, delta: w }, after: gap })),
  { part: { type: 'text-end', id }, after: 0 }
]
const call = (id: string, toolName: string, input: unknown, after = 350) => ({ part: { type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }, after })

const SUBTOTAL = '12 * 350'
function reply(prompt: any[]): { parts: Array<{ part: any, after: number }>, last: boolean } {
  const lastRole = prompt[prompt.length - 1]?.role
  if (lastRole === 'tool') {
    return { last: true, parts: [
      ...words('t2', 'The order comes to **GH₵ 4,320**: GH₵ 4,200 for the chairs plus GH₵ 120 delivery. I have laid out the week as three steps, with the delivery on Thursday morning so the customer can check the chairs the same day.'),
      finish('stop')
    ].map(p => ('part' in p ? p : { part: p, after: 0 })) }
  }
  return { last: false, parts: [
    { part: { type: 'stream-start', warnings: [] }, after: 0 },
    ...words('t1', 'Let me work out the total first, then plan the week.'),
    call('k1', 'calculator', { expression: `${SUBTOTAL} + 120`, label: '12 chairs at GH₵ 350 plus delivery' }),
    call('k2', 'plan', { title: 'Deliver the chair order', steps: [
      { task: 'Confirm the order and delivery address with Akosua Ltd', status: 'completed' },
      { task: 'Pack and check all 12 chairs on Wednesday', status: 'in_progress' },
      { task: 'Deliver on Thursday morning and collect the mobile money payment', status: 'pending' }
    ], summary: 'Total GH₵ 4,320' }, 500),
    { part: finish('tool-calls'), after: 200 }
  ] }
}

export async function installScriptedModel(vite: any) {
  const models = await vite.ssrLoadModule('/server/utils/models.ts') as any
  process.env.GEMINI_API_KEY ||= 'capture-only'
  models.useLanguageModelForTests((_id: string) => new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: 'Deliver the chair order' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }) as any,
    doStream: async ({ prompt }: any) => ({ stream: timed(reply(prompt).parts) })
  }))
}
