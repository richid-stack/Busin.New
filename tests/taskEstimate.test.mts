import { describeEstimate, estimateTaskCredits } from '../server/services/tasks/estimate'
import { createProposeTaskTool } from '../server/utils/tools/proposeTask'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
process.env.GEMINI_API_KEY = 'g'

// A 1-credit model, no AI-judged checks: one call per attempt, two attempts.
const flat = estimateTaskCredits({ criteria: [{ kind: 'file' }, { kind: 'manual' }], model: 'google/gemini-3.1-flash-lite' })
assert(flat.min === 1 && flat.max === 2, 'file and manual checks cost no extra model call')
// Each AI-judged check (and a page that must look right) is one more call per attempt.
const judged = estimateTaskCredits({ criteria: [{ kind: 'check' }, { kind: 'visual' }, { kind: 'file' }], model: 'google/gemini-3.1-flash-lite' })
assert(judged.min === 3 && judged.max === 6, 'AI-judged checks add a call each, per attempt')
// A dearer model costs more.
const dear = estimateTaskCredits({ criteria: [{ kind: 'check' }], model: 'google/gemini-3.8-flash' })
assert(dear.min === 4 && dear.max === 8, 'a 2-credit model doubles it')
{ const own = estimateTaskCredits({ criteria: [{ kind: 'check' }], model: 'my:openrouter/some-model' }); assert(own.min === 0 && own.max === 0, 'a model on the person\'s own key costs nothing') }
assert(estimateTaskCredits({ criteria: [], model: 'google/gemini-3.1-flash-lite', maxAttempts: 3 }).max === 3, 'the attempt limit is used')
assert(/About 3 to 6 credits/.test(describeEstimate(judged)) && describeEstimate({ min: 1, max: 1 }) === 'About 1 credit.', 'the line reads in plain words')
assert(/own model key/.test(describeEstimate({ min: 0, max: 0 })), 'a free run says why')

// The proposal carries the estimate for the card.
const t: any = createProposeTaskTool('u1')
const out = await t.execute({ goal: 'Research three competitors and write a one page summary', criteria: [{ text: 'A Word file exists', kind: 'file', format: 'docx' }, { text: 'It names three competitors', kind: 'check' }] }, { toolCallId: 'x', messages: [] })
assert(out.status === 'proposed' && out.estimate && out.estimate.max >= out.estimate.min && /credit/.test(out.estimate.text), 'the proposal includes a credit estimate')
