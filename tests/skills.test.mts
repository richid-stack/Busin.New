import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog, describeCatalog, parseSkill } from '../server/services/skills/parse'
import { createLoadSkillTool } from '../server/utils/tools/loadSkill'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const good = '---\nname: demo-skill\ndescription: Does a demo.\n---\n\nStep one.\n'

// Parser
const demo = parseSkill(good, 'demo-skill')
assert(demo.name === 'demo-skill' && demo.description === 'Does a demo.' && demo.body === 'Step one.', 'parses name, description and body')
assert(parseSkill(good.replace(/\n/g, '\r\n'), 'demo-skill').body === 'Step one.', 'accepts Windows line endings')
const bad = (raw: string, folder = 'demo-skill') => { try { parseSkill(raw, folder); return false } catch { return true } }
assert(bad('no frontmatter'), 'rejects a file without frontmatter')
assert(bad(good, 'other-folder'), 'rejects a name that does not match its folder')
assert(bad(good.replace('demo-skill', 'Demo_Skill'), 'Demo_Skill'), 'rejects a name that is not lowercase-hyphen')
assert(bad('---\nname: demo-skill\n---\nbody'), 'rejects a missing description')
assert(bad('---\nname: demo-skill\ndescription: x\n---\n'), 'rejects empty instructions')
assert(bad('---\nname: demo-skill\ndescription: [unclosed\n---\nbody'), 'rejects broken YAML')
assert(bad(`---\nname: demo-skill\ndescription: x\n---\n${'a'.repeat(20_001)}`), 'rejects oversized instructions')

// A broken skill is skipped, not fatal
const warnings: string[] = []
const catalog = buildCatalog({ '/s/zeta/SKILL.md': good.replace('demo-skill', 'zeta'), '/s/broken/SKILL.md': 'oops', '/s/alpha/SKILL.md': good.replace('demo-skill', 'alpha') }, m => warnings.push(m))
assert(catalog.map(s => s.name).join() === 'alpha,zeta' && warnings.length === 1, 'bad skills are skipped with a warning and the rest are sorted')

// Every skill shipped in /skills is valid
const root = join(import.meta.dirname, '..', 'skills')
const files: Record<string, string> = {}
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (dir.isDirectory()) files[join(root, dir.name, 'SKILL.md')] = readFileSync(join(root, dir.name, 'SKILL.md'), 'utf8')
}
const shipped = buildCatalog(files, m => { console.log('FAIL', m); process.exitCode = 1 })
assert(shipped.length === Object.keys(files).length && shipped.length >= 6, `all ${Object.keys(files).length} shipped skills are valid`)
assert(shipped.every(s => s.description.length >= 60 && /use when/i.test(s.description)), 'shipped descriptions say what the skill does and when to use it')
const known = new Set(['web_search', 'web_fetch', 'plan', 'calculator', 'chart', 'integration_status', 'integration_execute', 'workflow_create', 'workflow_run', 'load_skill'])
const mentioned = new Set(shipped.flatMap(s => [...s.body.matchAll(/`([a-z]+_[a-z_]+|plan|calculator|chart)`/g)].map(m => m[1]!)))
assert([...mentioned].every(t => known.has(t)), `skills only mention tools that exist (${[...mentioned].join(', ')})`)
assert(shipped.every(s => !/^#{1,6}\s/m.test(s.body)), 'skills avoid markdown headings (the chat forbids them)')
assert(describeCatalog(shipped).split('\n').length === shipped.length, 'catalog prompt has one line per skill')

// load_skill tool
assert(createLoadSkillTool('u', []) === null, 'no tool when there are no skills')
const tool = createLoadSkillTool('u-skill-test', catalog)!
const out: any = await (tool as any).execute({ name: 'alpha' }, {})
assert(out.status === 'ok' && out.instructions === 'Step one.' && /never override/.test(out.notice), 'load_skill returns the instructions with a notice')
assert(!(tool as any).inputSchema.safeParse({ name: 'nope' }).success, 'the model cannot ask for a skill that does not exist')
