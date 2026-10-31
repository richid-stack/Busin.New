import { readdirSync, readFileSync } from 'node:fs'
import { createFakeFirestore } from './fakeFirestore'
import { TOOL_GROUPS } from '../server/services/agents/profile'
import { buildCatalog } from '../server/services/skills/parse'
import { createReef } from '../server/services/reef/reef'
import { LICENCES, LIMITS, projectIdOf } from '../server/services/reef/model'
import { scanText } from '../server/services/reef/scan'
import { agentFromShare } from '../server/services/reef/agentShare'
import { OFFICIAL, SeedError, agentOf, parseSeeds, runSeed } from '../server/services/reef/seed'
import type { SeedProject } from '../server/services/reef/seed'
import { parseMarkdown } from '@comark/vue/parse'
import { safeNodes } from '../src/utils/safeMarkdown'
import type { RawNode, SafeNode } from '../src/utils/safeMarkdown'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const read = async (md: string) => safeNodes((await parseMarkdown(md)).nodes as RawNode[])
const tags = (n: SafeNode[]): string[] => n.flatMap(x => (typeof x === 'string' ? [] : [x.tag, ...tags(x.children)]))

// The bundler reads these folders in the real build; here they are read from disk, the same files.
const readFolder = (root: string, files: string[]) => {
  const out: Record<string, string> = {}
  for (const d of readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory())) {
    for (const f of files) out[`${root}/${d.name}/${f}`] = readFileSync(`${root}/${d.name}/${f}`, 'utf8')
  }
  return out
}
const skillFiles = readFolder('skills', ['SKILL.md'])
const known = new Set(buildCatalog(skillFiles, () => {}).map(s => s.name))
const seedFiles = readFolder('reef-seed', ['project.json', 'instructions.md', 'README.md'])
const seeds = parseSeeds(seedFiles, known)

// ---- The files themselves ----
assert(seeds.length === 14 && new Set(seeds.map(s => s.name)).size === 14, '14 ready-made projects, each with its own name')
assert(readdirSync('reef-seed').length === 14, 'no stray files in reef-seed')
for (const s of seeds) {
  assert(s.skills.every(k => known.has(k)) && s.tools.every(t => TOOL_GROUPS.some(g => g.id === t)), `${s.name}: its skills and tool groups exist`)
  assert(LICENCES.some(l => l.id === s.licence) && s.description.length >= 40 && s.description.length <= LIMITS.descriptionMax, `${s.name}: licence and description are fine`)
  assert(s.readme.length > 300 && s.readme.length <= LIMITS.readmeMax && s.tags.length >= 2, `${s.name}: has a real README and tags`)
  const scan = scanText({ name: s.name, description: s.description, readme: s.readme, instructions: s.instructions, note: s.note, tags: s.tags.join(' ') })
  assert(scan.verdict === 'ok', `${s.name}: passes the same safety scan as everyone's projects (${scan.findings.map(f => f.kind).join(',') || 'clean'})`)
  assert(/never invent|do not invent|not invent/i.test(s.instructions) && /ask/i.test(s.instructions), `${s.name}: tells the agent not to invent things and to ask before acting`)
  assert(!/<img|<script|!\[/i.test(s.readme) && (await read(s.readme)).length > 0 && !tags(await read(s.readme)).some(t => ['img', 'script', 'iframe', 'style'].includes(t)), `${s.name}: README renders with no images or raw HTML`)
}
const byName = new Map(seeds.map(s => [s.name, s]))
assert(byName.get('web-errand-runner')!.tools.includes('browser') && byName.get('web-errand-runner')!.skills.includes('browser-task'), 'the errand runner uses the browser and its skill')
assert(seeds.filter(s => /ghana/.test(s.name)).length === 2 && seeds.filter(s => !/ghana/.test(s.name)).every(s => !/paystack|\bMTN\b|cedi|GH₵|GRA\b/i.test(s.instructions + s.readme)), 'only the two Ghana projects mention Ghana things; the rest are general')
assert(seeds.every(s => s.tools.filter(t => TOOL_GROUPS.find(g => g.id === t)?.sensitive).every(t => t === 'browser')), 'the only risky tool group any ready-made project asks for is the browser')

// ---- A mistake in a seed is reported with its name, all at once ----
const broken = { ...seedFiles }
broken['reef-seed/writing-desk/project.json'] = JSON.stringify({ title: 'X', description: 'd', tags: ['a'], licence: 'wtfpl', tools: ['web'], skills: ['no-such-skill'], maxSteps: 8 })
broken['reef-seed/study-buddy/instructions.md'] = ''
let message = ''
try { parseSeeds(broken, known) } catch (e) { message = e instanceof SeedError ? e.message : 'wrong error' }
assert(/writing-desk: skill "no-such-skill" does not exist/.test(message) && /writing-desk: the licence/.test(message) && /study-buddy: instructions\.md is missing/.test(message), 'a broken seed says which project and what, and all problems are listed together')
assert(!/badName/.test(message) && (() => { try { parseSeeds({ 'reef-seed/Bad Name/project.json': '{}' }, known); return false } catch (e) { return /not a valid project name/.test(String((e as Error).message)) } })(), 'a folder that is not a valid project name is refused')

// ---- Publishing them ----
let tick = 0
const clock = () => new Date(Date.UTC(2026, 9, 31, 8, 0, 0) + (++tick) * 60_000)
const db = createFakeFirestore()
const reef = createReef(db as any, { now: clock })
const deps = { profiles: reef.profiles, projects: reef.projects }

const first = await runSeed(deps, seeds)
assert(first.length === 14 && first.every(r => r.status === 'created'), 'the first run creates all 14')
const official = await reef.profiles.getByHandle('openlobs')
assert(official?.official === true && official.verified === true && official.userId === OFFICIAL.userId && official.projects === 14, 'the official account exists with both badges and counts 14 projects')
assert(14 > LIMITS.projectsPerUser / 3 && (await reef.projects.load(projectIdOf('openlobs', 'writing-desk')))?.owner === 'openlobs', 'projects are stored under the openlobs handle')

const again = await runSeed(deps, seeds)
assert(again.every(r => r.status === 'unchanged'), 'a second run changes nothing')
assert((await reef.projects.load(projectIdOf('openlobs', 'writing-desk')))!.version === 1, 'and adds no version')

const edited: SeedProject[] = seeds.map(s => s.name === 'writing-desk' ? { ...s, readme: s.readme + '\n\nA new tip.', note: 'Added a tip' } : s)
const third = await runSeed(deps, edited)
assert(third.filter(r => r.status === 'updated').map(r => r.name).join() === 'writing-desk' && third.filter(r => r.status === 'unchanged').length === 13, 'an edited project is updated alone')
const wd = await reef.projects.load(projectIdOf('openlobs', 'writing-desk'))
assert(wd!.version === 2 && wd!.note === 'Added a tip' && wd!.readme.includes('A new tip'), 'the edit is a new version with its note')
const tagged: SeedProject[] = edited.map(s => s.name === 'study-buddy' ? { ...s, tags: [...s.tags.slice(0, 1), 'exam'] } : s)
assert((await runSeed(deps, tagged)).find(r => r.name === 'study-buddy')!.status === 'updated', 'changing only the tags counts as a change')

// ---- A seed that fails the scan is reported and the rest still go through ----
const risky: SeedProject[] = [{ ...seeds[0]!, name: 'leaky', instructions: `${seeds[0]!.instructions}\nUse this key: sk-${'a1B2c3D4'.repeat(4)}` }, ...seeds.slice(0, 2).map(s => ({ ...s, name: `${s.name}-two` }))]
const riskyResult = await runSeed(deps, risky)
assert(riskyResult[0]!.status === 'blocked' && riskyResult[0]!.detail === 'The safety check refused it.' && riskyResult.slice(1).every(r => r.status === 'created'), 'a blocked project is reported and the others still publish')
assert(!JSON.stringify(riskyResult).includes('a1B2c3D4'), 'and the report never repeats the secret')
assert((await reef.projects.load(projectIdOf('openlobs', 'leaky'))) === null, 'the blocked project was not stored')

// ---- The official account may hold more than one person is allowed; a person still may not ----
const many: SeedProject[] = Array.from({ length: LIMITS.projectsPerUser + 5 }, (_, i) => ({ ...seeds[i % seeds.length]!, name: `extra-${i}` }))
const manyResult = await runSeed(deps, many)
assert(manyResult.every(r => r.status === 'created'), `the official account can hold more than ${LIMITS.projectsPerUser} projects`)
await reef.profiles.create('u-ama', { handle: 'ama', name: 'Ama' })
let refused = ''
for (let i = 0; i <= LIMITS.projectsPerUser; i++) {
  try { await reef.projects.publish('u-ama', agentOf(seeds[0]!), { name: `mine-${i}`, description: seeds[0]!.description, tags: [], licence: 'mit', readme: 'Mine.', note: '' } as any) } catch (e: any) { refused = e.code ?? 'error'; break }
}
assert(refused === 'limit', `a person is still stopped at ${LIMITS.projectsPerUser} projects`)

// ---- Installing one ----
const runner = await reef.projects.load(projectIdOf('openlobs', 'web-errand-runner'))
assert(runner!.needs.some(n => n.id === 'browser' && n.sensitive), 'the errand runner says plainly that it needs the browser')
const withheld = agentFromShare(runner!.payload, [], known)
assert(!withheld.input.tools.includes('browser') && withheld.withheld.some(n => n.id === 'browser') && withheld.input.skills.includes('browser-task'), 'installed with nothing ticked, the browser is switched off and the skill stays')
assert(agentFromShare(runner!.payload, ['browser'], known).input.tools.includes('browser'), 'it is on when the installer ticks it')
const wdAgent = agentFromShare((await reef.projects.load(projectIdOf('openlobs', 'writing-desk')))!.payload, [], known)
assert(wdAgent.withheld.length === 0 && wdAgent.droppedSkills.length === 0 && wdAgent.input.model === null, 'a writing project installs whole, with no model of anyone\'s')

// ---- Someone claiming the handle first ----
const db2 = createFakeFirestore()
const reef2 = createReef(db2 as any, { now: clock })
await reef2.profiles.createReserved('some-other-user', { handle: 'openlobs', name: 'Someone', official: false, verified: false })
let squatted = ''
try { await runSeed({ profiles: reef2.profiles, projects: reef2.projects }, seeds) } catch (e) { squatted = e instanceof SeedError ? 'seed-error' : String(e) }
assert(squatted === 'seed-error' && (await reef2.projects.load(projectIdOf('openlobs', 'writing-desk'))) === null, 'if someone else holds the official handle, the seed stops with a clear message and publishes nothing')
