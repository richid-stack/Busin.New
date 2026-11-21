import { SPECIALISTS, specialistById } from '../shared/specialists'
import { CREATURES, PERSON_IDS, defaultPersonFor, isPersonId } from '../shared/mascots'
import { TOOL_GROUPS } from '../server/services/agents/profile'
import { SPECIALIST_MAX_STEPS, activeHandoff, appendInstructions, leadPrompt, offeredSpecialists, planStep, specialistToolNames } from '../server/services/specialists/handoff'
import { createHandToSpecialistTool, createReportBackTool } from '../server/utils/tools/specialists'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- The roster ----
assert(SPECIALISTS.length === 10 && new Set(SPECIALISTS.map(s => s.id)).size === 10 && SPECIALISTS.every(s => (CREATURES as readonly string[]).includes(s.id)), 'ten specialists, each with its own creature')
assert(SPECIALISTS.every(s => s.groups.every(g => TOOL_GROUPS.some(t => t.id === g))), 'every specialist uses real tool groups')
assert(!SPECIALISTS.some(s => (PERSON_IDS as string[]).includes(s.id)) && isPersonId('ama') && !isPersonId('pangolin'), 'creatures belong to specialists, people to agents')
assert(defaultPersonFor('Weekly report writer') === defaultPersonFor('Weekly report writer') && isPersonId(defaultPersonFor('x')), 'a default mascot is always a person, and is stable')
assert(specialistById('tortoise')?.role === 'Checker' && specialistById('nope') === null, 'a specialist is found by id')
const sensitive = TOOL_GROUPS.filter(g => g.sensitive).map(g => g.id)
assert(SPECIALISTS.every(s => s.instructions.length > 40 && s.when.length > 20), 'each specialist has instructions and a when')

// ---- Which specialists are offered, with which tools ----
const all = TOOL_GROUPS.flatMap(g => g.tools).concat(['load_skill', 'read_workspace_file'])
assert(offeredSpecialists(all).length === 10, 'with every tool, all ten are offered')
const lean = ['web_search', 'web_fetch', 'calculator', 'chart']
assert(offeredSpecialists(lean).map(s => s.id).join() === 'chameleon,tortoise,weaverbird,beetle', 'a specialist with no tools here is not offered')
assert(!offeredSpecialists(['browser']).some(s => s.id === 'pangolin') && offeredSpecialists(['browser']).some(s => s.id === 'hornbill'), 'the browser operator needs the browser')
const hornbill = specialistById('hornbill')!
assert(specialistToolNames(hornbill, all).join() === 'browser,load_skill,read_workspace_file', 'a specialist gets only its own groups plus the chat\'s shared tools')
assert(!specialistToolNames(specialistById('chameleon')!, all).includes('integration_execute') && sensitive.includes('apps'), 'the researcher cannot act in the person\'s apps')

// ---- Who is working, from the messages ----
const user = { role: 'user', content: 'Check the new pricing page and compare it with ours' }
const call = (name: string, input: any, id: string) => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input }] })
const result = (name: string, value: any, id: string) => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'json', value } }] })
const handed = [user, call('hand_to_specialist', { specialist: 'chameleon', brief: 'Compare the pricing pages.' }, 'h1'), result('hand_to_specialist', { status: 'handed', specialist: 'chameleon' }, 'h1')]
assert(activeHandoff([user]) === null, 'nobody is handed anything at the start')
assert(activeHandoff(handed)?.specialist.id === 'chameleon' && activeHandoff(handed)?.brief === 'Compare the pricing pages.', 'after a handoff the specialist is working')
const worked = [...handed, call('web_search', { query: 'a' }, 's1'), result('web_search', {}, 's1'), call('web_fetch', { url: 'u' }, 's2'), result('web_fetch', {}, 's2')]
assert(activeHandoff(worked)?.steps === 2, 'its steps are counted')
const back = [...worked, call('report_back', { summary: 'Done' }, 'r1'), result('report_back', { status: 'reported' }, 'r1')]
assert(activeHandoff(back) === null, 'reporting back gives the job back to the lead')
assert(activeHandoff([user, call('hand_to_specialist', { specialist: 'chameleon', brief: 'x'.repeat(20) }, 'h1'), result('hand_to_specialist', { status: 'failed' }, 'h1')]) === null, 'a handoff that failed never started')
assert(activeHandoff([user, call('hand_to_specialist', { specialist: 'dragon', brief: 'x'.repeat(20) }, 'h1')]) === null, 'an unknown specialist is ignored')
assert(activeHandoff([...handed, call('hand_to_specialist', { specialist: 'hornbill', brief: 'Take over.' }, 'h2')])?.specialist.id === 'chameleon', 'a specialist cannot hand the job to another one')
assert(activeHandoff([...handed, { role: 'assistant', content: [{ type: 'text', text: 'Here is the answer' }] }, { role: 'user', content: 'thanks, now something else' }]) === null, 'a handoff never carries into the next question')
assert(activeHandoff([user, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'h1', toolName: 'hand_to_specialist', input: { specialist: 'beetle', brief: 'Make the sheet.' } }, { type: 'tool-approval-request', approvalId: 'a', toolCallId: 'h1' }] }])?.specialist.id === 'beetle', 'it still holds while waiting for an approval')

// ---- What the next step may use ----
const names = [...all, 'hand_to_specialist', 'report_back']
const lead = planStep({ messages: [user], toolNames: names, instructions: 'Rules.' })
assert(lead.activeTools.includes('hand_to_specialist') && !lead.activeTools.includes('report_back') && lead.instructions === 'Rules.' && lead.toolChoice === undefined, 'the lead keeps its tools, without report_back, and its own instructions')
const spec = planStep({ messages: worked, toolNames: names, instructions: 'Rules.' })
assert(spec.activeTools.includes('report_back') && spec.activeTools.includes('web_search') && !spec.activeTools.includes('hand_to_specialist') && !spec.activeTools.includes('integration_execute') && !spec.activeTools.includes('browser'), 'a specialist gets its own tools and report_back, never hand_to_specialist or other kinds of tools')
assert(typeof spec.instructions === 'string' && spec.instructions.startsWith('Rules.') && /CHAMELEON/.test(spec.instructions) && /Compare the pricing pages/.test(spec.instructions), 'its instructions are added after the chat\'s own, with the brief')
const many = [...handed]; for (let i = 0; i < SPECIALIST_MAX_STEPS; i++) many.push(call('web_search', {}, `m${i}`), result('web_search', {}, `m${i}`))
const out = planStep({ messages: many, toolNames: names, instructions: 'Rules.' })
assert(out.activeTools.join() === 'report_back' && out.toolChoice?.toolName === 'report_back', 'out of steps, a specialist can only report back')
assert(appendInstructions(undefined, 'x') === 'x' && Array.isArray(appendInstructions([{ role: 'system', content: 'a' }], 'x')) && (appendInstructions({ role: 'system', content: 'a' }, 'x') as any[]).length === 2, 'instructions can be added to text or to a cached message')

// ---- Prompts and tools ----
assert(/Tortoise/.test(leadPrompt(offeredSpecialists(all))) && !/Tortoise/.test(leadPrompt(offeredSpecialists(['browser']))), 'the lead is told about the Checker only when it exists')
assert(/Chameleon/.test(leadPrompt(offeredSpecialists(all))) && /answer the person yourself/.test(leadPrompt(offeredSpecialists(all))), 'the lead is told who is available, and to answer the person itself')
const hand = createHandToSpecialistTool('u1', offeredSpecialists(all)) as any
const run = (t: any, input: unknown, messages: any[] = []) => t.execute(input, { toolCallId: 'x', messages })
assert((await run(hand, { specialist: 'chameleon', brief: 'Compare the pricing pages.' })).status === 'handed', 'handing over works')
assert((await run(createHandToSpecialistTool('u1', offeredSpecialists(['browser'])) as any, { specialist: 'pangolin', brief: 'Run the tests please.' })).status === 'failed', 'a specialist that is not offered cannot be handed a job')
const rb = createReportBackTool() as any
assert((await run(rb, { summary: 'Nothing to report' }, [user])).status === 'failed', 'reporting back with no open job is refused')
assert((await run(rb, { summary: 'Prices differ by 12%.' }, worked)).status === 'reported', 'a specialist can report back')

// ---- Through a real streamText run (scripted model), wired the way the chat route wires it ----
{
  const { streamText, tool, isStepCount, simulateReadableStream } = await import('ai')
  const { MockLanguageModelV4 } = await import('ai/test')
  const { z } = await import('zod')
  const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
  const callPart = (id: string, name: string, input: unknown) => [{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }]
  const textPart = (text: string) => [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }]
  const chunks = (parts: any[]) => ({ stream: simulateReadableStream({ chunks: parts, chunkDelayInMs: null, initialDelayInMs: null }) })
  const base = {
    web_search: tool({ description: 'search', inputSchema: z.object({ query: z.string() }), execute: async () => ({ results: [] }) }),
    calculator: tool({ description: 'calc', inputSchema: z.object({ e: z.string() }), execute: async () => ({ value: 1 }) }),
    browser: tool({ description: 'browser', inputSchema: z.object({}), execute: async () => ({}) })
  }
  const offered = offeredSpecialists(Object.keys(base))
  const tools: any = { ...base, hand_to_specialist: createHandToSpecialistTool('u1', offered), report_back: createReportBackTool() }
  const seen: Array<{ names: string[], system: string, choice: any }> = []
  const record = (o: any) => seen.push({
    names: (o.tools ?? []).map((t: any) => t.name),
    system: (o.prompt ?? []).filter((m: any) => m.role === 'system').map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n'),
    choice: o.toolChoice
  })
  const runIt = async (script: any[][], stepsAfterCap = 12) => {
    seen.length = 0
    let i = 0
    const model = new MockLanguageModelV4({ doStream: async (o: any) => { record(o); return chunks(script[Math.min(i++, script.length - 1)]!) } })
    const r = streamText({
      model, instructions: 'Rules.', messages: [{ role: 'user', content: 'Compare two pricing pages' }], tools, maxRetries: 0, onError: () => {},
      stopWhen: isStepCount(stepsAfterCap),
      prepareStep: ({ messages, initialInstructions }: any) => planStep({ messages, toolNames: Object.keys(tools), instructions: initialInstructions }) as any
    })
    for await (const _ of r.stream as any) { /* drain */ }
    return r
  }

  await runIt([
    callPart('h1', 'hand_to_specialist', { specialist: 'chameleon', brief: 'Compare the pricing pages of Acme and Beta.' }),
    callPart('s1', 'web_search', { query: 'acme pricing' }),
    callPart('r1', 'report_back', { summary: 'Acme is cheaper at Team level.' }),
    textPart('Chameleon compared them.')
  ])
  assert(seen.length === 4, 'the run takes four steps: hand over, work, report, answer')
  assert(seen[0]!.names.includes('hand_to_specialist') && !seen[0]!.names.includes('report_back') && !/CHAMELEON/.test(seen[0]!.system), 'step 1: the lead, with its own tools and instructions')
  assert(seen[1]!.names.sort().join() === 'report_back,web_search' && /CHAMELEON/.test(seen[1]!.system) && /Compare the pricing pages of Acme and Beta/.test(seen[1]!.system) && /^Rules\./.test(seen[1]!.system), 'step 2: Chameleon has only its own tools, its instructions and the brief')
  assert(seen[2]!.names.sort().join() === 'report_back,web_search' && /CHAMELEON/.test(seen[2]!.system), 'step 3: still Chameleon, and it can report back')
  assert(seen.every(x => (x.system.match(/YOU ARE NOW/g) ?? []).length <= 1), 'the specialist block is never added twice')
  assert(seen[3]!.names.includes('hand_to_specialist') && !seen[3]!.names.includes('report_back') && !/CHAMELEON/.test(seen[3]!.system), 'step 4: the job is back with the lead, who answers')

  await runIt([callPart('h1', 'hand_to_specialist', { specialist: 'chameleon', brief: 'Compare the pricing pages.' }), callPart('s', 'web_search', { query: 'x' })], 14)
  const forced = seen.filter(s => s.choice?.type === 'tool' && s.choice.toolName === 'report_back')
  assert(forced.length > 0 && forced[0]!.names.join() === 'report_back' && /out of steps/.test(forced[0]!.system), 'a specialist that never stops is made to report back')
  assert(seen.length === 1 + SPECIALIST_MAX_STEPS + forced.length && seen.slice(1, 1 + SPECIALIST_MAX_STEPS).every(s => s.names.includes('web_search')), 'it gets exactly its step allowance first')
}
