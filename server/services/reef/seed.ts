import crypto from 'node:crypto'
import { agentInputSchema, MAX_INSTRUCTIONS_CHARS } from '../agents/profile'
import type { Agent } from '../agents/profile'
import { LICENCES, LIMITS, PROJECT_NAME_RE, ReefError, projectIdOf } from './model'
import type { ProfileStore } from './profiles'
import { filesOf, publishSchema } from './projects'
import type { ProjectStore } from './projects'
import { payloadOf } from './agentShare'

/**
 * The ready-made projects OpenLobs publishes in The Reef under its own official account. They live in the repository
 * (`reef-seed/<name>/`: `project.json`, `instructions.md`, `README.md`), so anyone can read, fix or add one in a pull
 * request, and they are published through the same path as anyone's project: the same safety scan, the same limits,
 * the same versions. Running it again changes only what changed and never creates a duplicate.
 */

/** The account the official projects belong to. Nobody signs in as it; only the seed writes to it. */
export const OFFICIAL = {
  userId: 'reef-official',
  handle: 'openlobs',
  name: 'OpenLobs',
  bio: 'Ready-made agents from the people who build OpenLobs. Free to use, copy and change.',
  place: ''
}

export class SeedError extends Error {}

export interface SeedProject {
  /** The project's name in The Reef (the folder name). */
  name: string
  title: string
  description: string
  tags: string[]
  licence: string
  tools: string[]
  skills: string[]
  maxSteps: number
  note: string
  instructions: string
  readme: string
}

/** Reads the seed folders. `files` maps a path ending in `<name>/<file>` to the text of the file. Every problem is reported at once. */
export function parseSeeds(files: Record<string, string>, knownSkills: Set<string>): SeedProject[] {
  const byName = new Map<string, Record<string, string>>()
  for (const [path, text] of Object.entries(files)) {
    const parts = path.replace(/\\/g, '/').split('/')
    const file = parts.pop()!
    const name = parts.pop()!
    if (!['project.json', 'instructions.md', 'README.md'].includes(file)) continue
    byName.set(name, { ...(byName.get(name) ?? {}), [file]: text })
  }
  const problems: string[] = []
  const out: SeedProject[] = []
  for (const [name, f] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const bad = (m: string) => problems.push(`${name}: ${m}`)
    if (!PROJECT_NAME_RE.test(name)) bad('the folder name is not a valid project name')
    for (const need of ['project.json', 'instructions.md', 'README.md']) if (!f[need]?.trim()) bad(`${need} is missing or empty`)
    let meta: Record<string, any> = {}
    try { meta = JSON.parse(f['project.json'] ?? '{}') } catch { bad('project.json is not valid JSON') }
    const instructions = (f['instructions.md'] ?? '').trim()
    const readme = (f['README.md'] ?? '').trim()
    const skills: string[] = Array.isArray(meta.skills) ? meta.skills.map(String) : []
    for (const s of skills) if (!knownSkills.has(s)) bad(`skill "${s}" does not exist`)
    if (!LICENCES.some(l => l.id === meta.licence)) bad('the licence is not one of the allowed ones')
    if (instructions.length > MAX_INSTRUCTIONS_CHARS) bad(`the instructions are longer than ${MAX_INSTRUCTIONS_CHARS} characters`)
    const description = String(meta.description ?? '')
    if (description.length > LIMITS.descriptionMax) bad(`the description is longer than ${LIMITS.descriptionMax} characters`)
    const tags: string[] = Array.isArray(meta.tags) ? meta.tags.map(String) : []
    if (tags.length > LIMITS.maxTags) bad(`more than ${LIMITS.maxTags} tags`)
    const seed: SeedProject = { name, title: String(meta.title ?? ''), description, tags, licence: String(meta.licence ?? ''), tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [], skills, maxSteps: Number(meta.maxSteps) || 8, note: String(meta.note ?? ''), instructions, readme }
    const agent = agentInputSchema.safeParse({ name: seed.title, description, instructions, tools: seed.tools, skills, maxSteps: seed.maxSteps })
    if (!agent.success) bad(agent.error.issues[0]!.message)
    out.push(seed)
  }
  if (problems.length) throw new SeedError(`The Reef seed has problems:\n- ${problems.join('\n- ')}`)
  return out
}

/** The agent a seed describes, in the shape the publish step takes. It has no model and belongs to the official account. */
export function agentOf(seed: SeedProject): Agent {
  const input = agentInputSchema.parse({ name: seed.title, description: seed.description, instructions: seed.instructions, tools: seed.tools, skills: seed.skills, maxSteps: seed.maxSteps, model: null })
  return { ...input, id: `seed-${seed.name}`, userId: OFFICIAL.userId, createdAt: '', updatedAt: '' } as Agent
}

const fingerprint = (value: unknown) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex')

export interface SeedResult { name: string, status: 'created' | 'updated' | 'unchanged' | 'blocked', detail?: string }

/**
 * Makes sure the official account exists and that each seed is published, at its newest content. A project that
 * already matches is left alone, so running this twice does not add a version. One that fails the safety scan is
 * reported and skipped, and the rest still go through.
 */
export async function runSeed(deps: { profiles: Pick<ProfileStore, 'get' | 'createReserved'>, projects: Pick<ProjectStore, 'load' | 'publish'> }, seeds: SeedProject[]): Promise<SeedResult[]> {
  let profile = await deps.profiles.get(OFFICIAL.userId)
  if (!profile) {
    try {
      profile = await deps.profiles.createReserved(OFFICIAL.userId, { handle: OFFICIAL.handle, name: OFFICIAL.name, bio: OFFICIAL.bio, place: OFFICIAL.place })
    } catch (err) {
      if (err instanceof ReefError && err.code === 'taken') throw new SeedError(`The handle "${OFFICIAL.handle}" already belongs to someone else, so the official projects were not published. Free it up (or hand it to ${OFFICIAL.userId}) and try again.`)
      throw err
    }
  }
  if (profile.handle !== OFFICIAL.handle || !profile.official) throw new SeedError(`The official account is not set up as "${OFFICIAL.handle}". Check the profile of ${OFFICIAL.userId}.`)
  const results: SeedResult[] = []
  for (const seed of seeds) {
    const agent = agentOf(seed)
    const parsed = publishSchema.parse({ name: seed.name, description: seed.description, tags: seed.tags, licence: seed.licence, readme: seed.readme, note: seed.note })
    const want = fingerprint({ files: filesOf({ readme: parsed.readme, payload: payloadOf(agent) }), description: parsed.description, tags: parsed.tags, licence: parsed.licence })
    try {
      const have = await deps.projects.load(projectIdOf(OFFICIAL.handle, seed.name))
      const haveFingerprint = have ? fingerprint({ files: filesOf(have), description: have.description, tags: have.tags, licence: have.licence }) : null
      if (have && haveFingerprint === want) { results.push({ name: seed.name, status: 'unchanged' }); continue }
      const { created } = await deps.projects.publish(OFFICIAL.userId, agent, { ...parsed, note: have ? (seed.note || 'Updated') : (seed.note || 'First version') })
      results.push({ name: seed.name, status: created ? 'created' : 'updated' })
    } catch (err) {
      if (err instanceof ReefError) { results.push({ name: seed.name, status: 'blocked', detail: err.code === 'blocked' ? 'The safety check refused it.' : err.message }); continue }
      throw err
    }
  }
  return results
}
