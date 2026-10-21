import { keywords, suggestAgent } from '../src/utils/agentSuggest'
import { makeProposal, PROPOSABLE_GROUPS } from '../server/services/agents/proposal'
import { createProposeAgentTool } from '../server/utils/tools/proposeAgent'
import { AGENT_PRESETS } from '../src/utils/agentPresets'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const run = (t: any, input: unknown) => t.execute(input, { toolCallId: 'x', messages: [] })

// ---- Suggesting one of your own agents ----
const agents = AGENT_PRESETS.filter(p => p.id !== 'blank').map(p => ({ id: p.id, name: p.agent.name, description: p.agent.description, instructions: p.agent.instructions }))
const hint = (text: string) => suggestAgent(text, agents)?.agent.id ?? null
assert(keywords('Please summarise the research sources for me').has('research') && !keywords('Please summarise').has('please'), 'keywords drop filler words')
assert(hint('Can you research the best sources on solar panel pricing and summarise them') === 'researcher', 'a research request points at the researcher')
assert(hint('Triage my inbox and draft replies to unread emails') === 'inbox', 'an inbox request points at the inbox agent')
assert(hint('What is the capital of Ghana?') === null, 'a plain question suggests nothing')
assert(hint('hi') === null && hint('') === null, 'too little text suggests nothing')
assert(suggestAgent('research research', agents) === null, 'one repeated word is not enough')
const twins = [{ id: 'a', name: 'Report writer', description: 'Writes weekly reports', instructions: 'x' }, { id: 'b', name: 'Report writer two', description: 'Writes weekly reports', instructions: 'y' }]
assert(suggestAgent('write the weekly reports now', twins) === null, 'two equally good matches suggest nothing rather than guessing')
assert(suggestAgent('anything research sources', []) === null, 'no agents, no suggestion')

// ---- Proposing a new one ----
const good = makeProposal({ name: 'Weekly report writer', description: 'Turns notes into a weekly report', instructions: 'You write a short weekly report from the notes the user gives you.', tools: ['read_files', 'create_files'] })
assert(good.ok && good.proposal.draft.tools.join() === 'read_files,create_files' && good.proposal.draft.model === null && good.proposal.draft.skills.length === 0, 'a good draft is accepted with a fixed, safe shape')
const greedy = makeProposal({ name: 'Mailer', instructions: 'Send emails.', tools: ['web', 'apps', 'workflows', 'mcp', 'shell'] })
assert(greedy.ok && greedy.proposal.draft.tools.join() === 'web' && greedy.proposal.dropped.join() === 'apps,workflows,mcp,shell', 'groups that act in accounts or do not exist are dropped and reported')
assert(PROPOSABLE_GROUPS.every(g => !['apps', 'workflows', 'mcp'].includes(g)), 'sensitive groups can never be proposed')
assert(!makeProposal({ name: '', instructions: 'x' }).ok && !makeProposal({ name: 'A', instructions: 'x'.repeat(5000) }).ok, 'an empty name or oversized instructions are refused')
const cleaned = makeProposal({ name: ' Tidy\u0007 ', instructions: 'Do it.\u0000' })
assert(cleaned.ok && cleaned.proposal.draft.name === 'Tidy' && cleaned.proposal.draft.instructions === 'Do it.', 'control characters are stripped')

const tool = createProposeAgentTool('u1')
const out = await run(tool, { name: 'Researcher', description: 'Finds sources', instructions: 'Find and cite sources.', tools: ['web', 'apps'] })
assert(out.status === 'proposed' && out.draft.tools.join() === 'web' && /Nothing is saved/.test(out.note), 'the tool returns a draft and says nothing is saved')
assert((await run(tool, { name: 'x', description: '', instructions: 'y', tools: [] })).status === 'proposed', 'a minimal draft works')
