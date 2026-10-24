import { actionLabel, stepDetail, stepsFrom } from '../server/utils/actionSteps'
import { withProgress } from '../server/utils/progressStream'
import { describeTools } from '../server/services/integrations/toolkitActions'
import { mergeToolSets, toolsForTask } from '../server/services/integrations/execute'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- What each step is called ----
assert(actionLabel('GITHUB_CREATE_AN_ISSUE', 'GitHub') === 'Create an issue', 'an action name becomes a sentence, without the app name in front')
assert(actionLabel('GMAIL_FETCH_EMAILS', 'Gmail') === 'Fetch emails' && actionLabel('mcp_tracker_create_issue') === 'Tracker create issue', 'other names read plainly too')
assert(stepDetail({ title: 'Login bug', body: 'x'.repeat(500) }) === 'Login bug' && stepDetail({ body: 'secret' }) === undefined && stepDetail('x') === undefined, 'a step shows its title or name, never a whole payload')
const modelSteps = [{ toolCalls: [{ toolCallId: 'a', toolName: 'GITHUB_LIST_ISSUES', input: { repo: 'x/y' } }, { toolCallId: 'b', toolName: 'GITHUB_CREATE_AN_ISSUE', input: { title: 'T' } }], toolResults: [{ toolCallId: 'a', output: { successful: true } }, { toolCallId: 'b', output: { successful: false, error: 'nope' } }], content: [] }]
const steps = stepsFrom(modelSteps, 'GitHub')
assert(steps.length === 2 && steps[0]!.status === 'done' && steps[1]!.status === 'failed' && steps[1]!.detail === 'T', 'a finished task lists every step with whether it worked')

// ---- Progress streams as it happens, then the result ----
const seen: string[] = []
for await (const u of withProgress<string, string>(async (report) => { report('one'); await new Promise(r => setTimeout(r, 20)); report('two'); await new Promise(r => setTimeout(r, 20)); return 'done' })) seen.push('progress' in u ? u.progress : `result:${u.result}`)
assert(seen.join() === 'one,two,result:done', 'each report comes out as it happens and the result comes last')
const failure = await (async () => { try { const stream = withProgress<string, string>(async () => { throw new Error('boom') })
    while (!(await stream.next()).done) { /* drain */ } return 'no error' } catch (e: any) { return e.message } })()
assert(failure === 'boom', 'a job that fails is reported, not swallowed')

// ---- What an app offers ----
const listed = describeTools([{ slug: 'CANVA_LIST_FOLDER_ITEMS', name: 'List items', description: 'Lists   things\nin a folder' }, { slug: 'CANVA_CREATE_DESIGN', name: 'Create design' }, { slug: '' }, {}])
assert(listed.total === 2 && listed.actions[0]!.effect === 'read' && listed.actions[1]!.effect === 'change' && listed.actions[0]!.description === 'Lists things in a folder', 'the real list marks each action as reading or changing, reads first')

// ---- The model gets the important tools plus the best matches from the whole app ----
const asked: any[] = []
const fakeClient: any = { tools: { get: async (_u: string, q: any) => { asked.push(q); if (q.search) return { CANVA_SEARCHED: 1, CANVA_COMMON: 'matching copy' }; return { CANVA_COMMON: 'important copy', CANVA_IMPORTANT: 1 } } } }
const got = await toolsForTask(fakeClient, 'u', 'canva', 'find my brand templates')
assert(Object.keys(got).sort().join() === 'CANVA_COMMON,CANVA_IMPORTANT,CANVA_SEARCHED' && got.CANVA_COMMON === 'important copy', 'the important tools and the best matches are both offered, without duplicates')
assert(asked[1].search === 'find my brand templates' && asked[1].limit === 15 && asked[0].search === undefined, 'the match is searched across the whole app for this very task')
const failing: any = { tools: { get: async (_u: string, q: any) => { if (q.search) throw new Error('search down'); return { A: 1 } } } }
assert(Object.keys(await toolsForTask(failing, 'u', 'canva', 'x')).join() === 'A', 'if the search fails, the important tools still work')
assert(Object.keys(mergeToolSets({ a: 1 }, null)).join() === 'a', 'nothing extra is fine')
