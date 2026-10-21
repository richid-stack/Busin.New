import { executeWorkflowDAG } from '../server/utils/workflowEngine'
const wf = (nodes: any[], edges: any[]) => ({ id: 'w', title: 't', userId: 'u', status: 'active', nodes, edges, createdAt: new Date() }) as any
const n = (id: string, type: string, data: any = {}) => ({ id, type, data: { title: id, ...data } })
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle })
const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// 1. branching + sandbox
let r = await executeWorkflowDAG(wf(
  [n('t','trigger'), n('c','logic',{subtype:'code',code:'return inputs.trigger.payload.n > 5'}), n('i','logic',{subtype:'if-else',condition:'c.result'}),
   n('yes','logic',{subtype:'code',code:'return "yes"'}), n('no','logic',{subtype:'code',code:'return "no"'})],
  [e('t','c'), e('c','i'), e('i','yes','true'), e('i','no','false')]), { payload: {n: 9} }, 'u')
const st = Object.fromEntries(r.logs.map(l => [l.nodeId, l.status]))
assert(r.status === 'completed', 'branching run completed')
assert(st.yes === 'completed' && st.no === 'skipped', `true branch runs, false skipped (${JSON.stringify(st)})`)

// 2. sandbox escape does not reach host
r = await executeWorkflowDAG(wf([n('t','trigger'), n('x','logic',{subtype:'code',code:'return typeof process + typeof require + typeof fetch'})],[e('t','x')]), undefined, 'u')
assert(r.outputs.x.result === 'undefinedundefinedundefined', 'sandbox has no process/require/fetch')
r = await executeWorkflowDAG(wf([n('t','trigger'), n('x','logic',{subtype:'code',code:'while(true){}'})],[e('t','x')]), undefined, 'u')
assert(r.status === 'failed' && r.logs.find(l=>l.nodeId==='x')?.status==='failed', 'infinite loop is interrupted and run reports failed')

// 3. approval pause is serialisable (was circular) + resume with a join and a parallel branch
const nodes = [n('t','trigger'), n('a','logic',{subtype:'code',code:'return 1'}), n('ap','approval',{approvalPrompt:'ok?'}),
  n('b','logic',{subtype:'code',code:'return 2'}), n('join','logic',{subtype:'code',code:'return inputs.a.result + inputs.b.result'})]
const edges = [e('t','a'), e('a','ap'), e('ap','b'), e('a','join'), e('b','join')]
const p = await executeWorkflowDAG(wf(nodes, edges), undefined, 'u')
assert(p.status === 'waiting_approval' && p.approvalNodeId === 'ap', 'pauses at approval')
let serialisable = true; try { JSON.stringify(p) } catch { serialisable = false }
assert(serialisable, 'paused result is JSON-serialisable (no circular refs)')
const res = await executeWorkflowDAG(wf(nodes, edges), undefined, 'u', { resumeNodeId: 'ap', existingOutputs: p.outputs, existingLogs: p.logs, approvalDecision: { approved: true, approver: 'me' } })
const st2 = Object.fromEntries(res.logs.map(l => [l.nodeId, l.status]))
assert(res.status === 'completed' && st2.b === 'completed' && st2.join === 'completed', `resume finishes downstream join (${JSON.stringify(st2)})`)
assert(res.outputs.join.result === 3, 'join sees both parents')
const rej = await executeWorkflowDAG(wf(nodes, edges), undefined, 'u', { resumeNodeId: 'ap', existingOutputs: p.outputs, existingLogs: p.logs, approvalDecision: { approved: false } })
assert(rej.status === 'rejected', 'rejection ends as rejected')

// 4. agent without AI keys fails honestly (no canned text)
for (const k of ['GEMINI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY','GROQ_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']) delete process.env[k]
r = await executeWorkflowDAG(wf([n('t','trigger'), n('ag','agent',{prompt:'hi'})],[e('t','ag')]), undefined, 'u')
assert(r.status === 'failed' && /No AI provider/.test(r.logs.find(l=>l.nodeId==='ag')?.message || ''), 'agent without keys fails with a clear message')

// 5. cycle is reported, not faked
r = await executeWorkflowDAG(wf([n('t','trigger'), n('x','logic',{subtype:'code',code:'return 1'}), n('y','logic',{subtype:'code',code:'return 1'})],[e('t','x'), e('x','y'), e('y','x')]), undefined, 'u')
assert(r.status === 'failed', 'cycle -> failed, not fake success')
