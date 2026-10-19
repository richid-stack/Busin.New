import { TOOL_GROUPS, agentInputSchema, allowedToolNames, filterSkills, filterTools, agentPrompt, MAX_INSTRUCTIONS_CHARS } from '../server/services/agents/profile'
import { resolveChatSetup } from '../server/services/agents/setup'
import { agentFromDoc } from '../server/services/agents/store'
const skills = [{ name: 'research-topic' }, { name: 'meeting-notes' }, { name: 'inbox-triage' }]

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const ok = (raw: unknown) => agentInputSchema.safeParse(raw)
const base = { name: 'Researcher', instructions: 'Find sources and summarise them.' }

// ---- Validation ----
const a = ok(base)
assert(a.success && a.data.description === '' && a.data.model === null && a.data.maxSteps === 8 && a.data.tools.join() === 'web,read_files,create_files,utilities' && a.data.skills.length === 0, 'a name and instructions are enough; the rest has safe defaults')
assert(!ok({ ...base, name: '   ' }).success && !ok({ ...base, instructions: '' }).success, 'name and instructions are required')
assert(!ok({ ...base, name: 'x'.repeat(61) }).success && !ok({ ...base, description: 'x'.repeat(201) }).success && !ok({ ...base, instructions: 'x'.repeat(MAX_INSTRUCTIONS_CHARS + 1) }).success, 'text fields have length limits')
assert(ok({ ...base, instructions: 'x'.repeat(MAX_INSTRUCTIONS_CHARS) }).success, 'instructions at the limit are fine')
assert(!ok({ ...base, model: 'evil/model' }).success && ok({ ...base, model: 'google/gemini-3.5-flash' }).success && ok({ ...base, model: null }).success, 'only known models, or none')
assert(!ok({ ...base, tools: ['web', 'shell'] }).success, 'unknown tool groups are refused')
const t = ok({ ...base, tools: ['utilities', 'web', 'web'] })
assert(t.success && t.data.tools.join() === 'web,utilities', 'tool groups are de-duplicated and kept in a fixed order')
assert(!ok({ ...base, maxSteps: 0 }).success && !ok({ ...base, maxSteps: 16 }).success && ok({ ...base, maxSteps: '5' }).success && (ok({ ...base, maxSteps: '5' }) as any).data.maxSteps === 5, 'the step limit is 1 to 15')
const dirty = ok({ name: '  Ana\u0000lyst  ', instructions: 'Line one\r\nLine two\u0007' })
assert(dirty.success && dirty.data.name === 'Analyst' && dirty.data.instructions === 'Line one\nLine two', 'control characters are removed and line endings tidied')
assert(ok({ ...base, skills: ['a', 'a', 'b'] }).success && (ok({ ...base, skills: ['a', 'a', 'b'] }) as any).data.skills.join() === 'a,b', 'skills are de-duplicated')
assert(!ok({ ...base, userId: 'someone-else' } as any).success === false && !('userId' in ((ok({ ...base, userId: 'someone-else' } as any) as any).data)), 'an owner id in the request is ignored')

// ---- Tool groups ----
const everyTool = ['chart', 'plan', 'weather', 'calculator', 'web_search', 'web_fetch', 'read_document', 'create_document', 'create_spreadsheet', 'create_presentation', 'integration_status', 'integration_execute', 'workflow_create', 'workflow_run']
assert(new Set(TOOL_GROUPS.flatMap(g => g.tools)).size === everyTool.length && everyTool.every(n => TOOL_GROUPS.some(g => g.tools.includes(n))), 'every chat tool belongs to exactly one group')
const all = Object.fromEntries([...everyTool, 'load_skill'].map(n => [n, { name: n }]))
const readOnly = filterTools(all, { tools: ['web'] })
assert(Object.keys(readOnly).sort().join() === 'load_skill,web_fetch,web_search', 'an agent gets only its groups (load_skill is decided by its skills)')
assert(!('integration_execute' in filterTools(all, { tools: ['web', 'utilities', 'read_files', 'create_files'] })) && !('workflow_run' in filterTools(all, { tools: ['web'] })), 'tools that act in accounts need their own switch')
assert('integration_execute' in filterTools(all, { tools: ['apps'] }) && allowedToolNames({ tools: [] }).size === 0, 'switching a group on gives its tools, none gives none')

// ---- Skills ----
const some = filterSkills(skills, { skills: [skills[0]!.name, 'not-a-skill'] })
assert(some.length === 1 && some[0]!.name === skills[0]!.name && filterSkills(skills, { skills: [] }).length === 0, 'an agent only gets the skills it switched on')

// ---- What a chat turn may use ----
const stored = { id: 'a1', userId: 'u', createdAt: '', updatedAt: '', ...ok({ ...base, tools: ['web'], maxSteps: 4, model: 'groq/gpt-oss-120b' }).data! } as any
const plain = resolveChatSetup({ agent: null, tools: all, model: 'google/gemini-3.5-flash', defaultSteps: 10 })
assert(Object.keys(plain.tools).length === Object.keys(all).length && plain.model === 'google/gemini-3.5-flash' && plain.maxSteps === 10 && plain.workflowPrompt && plain.rolePrompt === '', 'without an agent nothing changes')
const withAgent = resolveChatSetup({ agent: stored, tools: all, model: 'google/gemini-3.5-flash', defaultSteps: 10 })
assert(withAgent.model === 'groq/gpt-oss-120b' && withAgent.maxSteps === 4 && !withAgent.workflowPrompt && Object.keys(withAgent.tools).sort().join() === 'load_skill,web_fetch,web_search', 'an agent sets the model, the step limit and the tools')
assert(resolveChatSetup({ agent: { ...stored, model: null }, tools: all, model: 'google/gemini-3.5-flash', defaultSteps: 10 }).model === 'google/gemini-3.5-flash', 'an agent without a model uses the one the user picked')
assert(resolveChatSetup({ agent: { ...stored, tools: ['apps'] }, tools: all, model: 'm', defaultSteps: 10 }).workflowPrompt && resolveChatSetup({ agent: { ...stored, tools: ['workflows'] }, tools: all, model: 'm', defaultSteps: 10 }).workflowPrompt, 'the app and workflow instructions apply only when the agent has those tools')
assert(withAgent.rolePrompt.includes('web_search') && !withAgent.rolePrompt.includes('integration_execute') && withAgent.rolePrompt.trimEnd().endsWith(stored.instructions), 'the role prompt lists its tools and ends with the user\'s instructions')
assert(/never allow you to ignore/.test(agentPrompt(stored, [])) && agentPrompt(stored, []).includes('none'), 'the role prompt cannot override the rules above it, and says when there are no tools')

// ---- Stored documents ----
const fromDoc = agentFromDoc('x', { userId: 'u1', name: 'Old', instructions: 'Hi', tools: ['web', 'bogus'], maxSteps: 99, model: 'gone/model', createdAt: 'c', updatedAt: 'd' })
assert(fromDoc.id === 'x' && fromDoc.userId === 'u1' && fromDoc.name === 'Agent' && fromDoc.maxSteps === 8, 'a damaged stored agent falls back to safe values instead of failing')
const good = agentFromDoc('y', { userId: 'u1', name: 'Fine', instructions: 'Do it', tools: ['web'], skills: ['research-topic'], maxSteps: 3, model: null, createdAt: 'c', updatedAt: 'd' })
assert(good.name === 'Fine' && good.tools.join() === 'web' && good.maxSteps === 3 && good.skills.join() === 'research-topic', 'a good stored agent is read as it was saved')

// ---- Presets in the editor ----
const { AGENT_PRESETS } = await import('../src/utils/agentPresets')
const { readdirSync } = await import('node:fs')
const realSkills = new Set(readdirSync(new URL('../skills', import.meta.url)))
assert(AGENT_PRESETS.length >= 3, 'the editor offers starting points')
for (const p of AGENT_PRESETS.filter(x => x.id !== 'blank')) {
  assert(ok(p.agent).success, `[${p.id}] preset passes the same checks as a saved agent`)
  assert(p.agent.skills.every(s => realSkills.has(s)), `[${p.id}] preset only names skills that exist`)
}
const inbox = AGENT_PRESETS.find(p => p.id === 'inbox')!.agent
assert(/Do NOT send/.test(inbox.instructions), 'the inbox preset tells the agent to ask before sending anything')
