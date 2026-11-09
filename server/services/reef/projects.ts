import crypto from 'node:crypto'
import { z } from 'zod'
import { assertNotDeleting } from '../account/tombstone'
import type { Agent, AgentInput } from '../agents/profile'
import type { TaskDb } from '../tasks/store'
import { scanText } from './scan'
import type { ScanResult } from './scan'
import { agentFromShare, needsOf, payloadOf } from './agentShare'
import type { Need, SharedAgent } from './agentShare'
import { DEFAULT_LICENCE, LICENCES, LIMITS, PROJECT_NAME_RE, ReefError, cleanText, projectIdOf, tagOf } from './model'
import type { LicenceId } from './model'
import { notify } from './alerts'
import type { ProfileStore } from './profiles'
import { authorOf } from './profiles'

/**
 * Projects in The Reef. A project is what a person built with OpenLobs and chose to share: today an agent
 * (workflows, tasks and packs follow). It is a small repository of text: a README, the instructions, the
 * settings, a numbered version history, and a licence the maker picked. Nothing in a project is code to
 * run, and it never carries a model, a key, a chat or a connection.
 */

export const PROJECTS = 'reef_projects'
export const VERSIONS = 'reef_versions'
export const STARS = 'reef_stars'

export type ProjectKind = 'agent'

export interface FileLog { note: string, at: string, bytes: number, hash: string }

export interface ProjectDoc {
  id: string
  userId: string
  owner: string
  name: string
  kind: ProjectKind
  description: string
  tags: string[]
  licence: LicenceId
  readme: string
  payload: SharedAgent
  needs: Need[]
  scan: ScanResult
  /** The newest version number. */
  version: number
  /** What the newest version changed. */
  note: string
  stars: number
  forks: number
  installs: number
  hidden: boolean
  forkedFrom: { owner: string, name: string, version: number } | null
  /** For each file: when it last changed and why. This is what the file table shows. */
  files: Record<string, FileLog>
  createdAt: string
  updatedAt: string
}

export interface ProjectCard {
  owner: string
  name: string
  kind: ProjectKind
  description: string
  tags: string[]
  licence: { id: LicenceId, short: string }
  version: number
  stars: number
  forks: number
  installs: number
  safety: 'passed' | 'review'
  forkedFrom: ProjectDoc['forkedFrom']
  /** What the project needs to work, in the same words as the agent editor. */
  works: Array<{ id: string, label: string, sensitive: boolean }>
  updatedAt: string
  createdAt: string
}

export interface ProjectVersion { version: number, note: string, createdAt: string }

export interface ProjectDetail extends ProjectCard {
  readme: string
  instructions: string
  skills: string[]
  needs: Need[]
  scan: ScanResult
  versions: ProjectVersion[]
  files: Array<{ name: string, kind: 'dir' | 'file', note: string, at: string }>
  made: Array<{ label: string, pct: number }>
  isOwner: boolean
  starred: boolean
}

const licenceOf = (id: string) => LICENCES.find(l => l.id === id) ?? LICENCES[0]!

export const projectCard = (p: ProjectDoc): ProjectCard => ({
  owner: p.owner,
  name: p.name,
  kind: p.kind,
  description: p.description,
  tags: p.tags,
  licence: { id: licenceOf(p.licence).id, short: licenceOf(p.licence).short },
  version: p.version,
  stars: p.stars,
  forks: p.forks,
  installs: p.installs,
  safety: p.scan.verdict === 'ok' ? 'passed' : 'review',
  forkedFrom: p.forkedFrom,
  works: p.needs.map(n => ({ id: n.id, label: n.label, sensitive: n.sensitive })),
  updatedAt: p.updatedAt,
  createdAt: p.createdAt
})

function fromDoc(id: string, d: Record<string, any>): ProjectDoc {
  return {
    id,
    userId: String(d.userId || ''),
    owner: String(d.owner || ''),
    name: String(d.name || ''),
    kind: 'agent',
    description: String(d.description || ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    licence: licenceOf(String(d.licence)).id,
    readme: String(d.readme || ''),
    payload: d.payload,
    needs: Array.isArray(d.needs) ? d.needs : [],
    scan: d.scan ?? { verdict: 'ok', findings: [] },
    version: Number(d.version) || 1,
    note: String(d.note || ''),
    stars: Number(d.stars) || 0,
    forks: Number(d.forks) || 0,
    installs: Number(d.installs) || 0,
    hidden: d.hidden === true,
    forkedFrom: d.forkedFrom ?? null,
    files: d.files && typeof d.files === 'object' ? d.files : {},
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || '')
  }
}

export const publishSchema = z.object({
  name: z.string().transform(s => s.trim().toLowerCase()).pipe(z.string().regex(PROJECT_NAME_RE, 'A project name is 1 to 40 letters, numbers or dashes, and cannot start or end with a dash.')),
  description: z.string().transform(cleanText).pipe(z.string().max(LIMITS.descriptionMax, `The description can be at most ${LIMITS.descriptionMax} characters.`)).default(''),
  tags: z.array(z.string()).max(LIMITS.maxTags * 2).default([]).transform(list => [...new Set(list.map(tagOf).filter(Boolean))].slice(0, LIMITS.maxTags)),
  licence: z.enum(LICENCES.map(l => l.id) as [LicenceId, ...LicenceId[]]).default(DEFAULT_LICENCE),
  readme: z.string().transform(cleanText).pipe(z.string().max(LIMITS.readmeMax, `The README can be at most ${LIMITS.readmeMax} characters.`)).default(''),
  note: z.string().transform(s => cleanText(s).replace(/\s+/g, ' ')).pipe(z.string().max(LIMITS.noteMax, `The note can be at most ${LIMITS.noteMax} characters.`)).default('')
})
export type PublishInput = z.input<typeof publishSchema>

const sha = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)

/** The files a project shows, made from what it holds. */
export function filesOf(p: Pick<ProjectDoc, 'readme' | 'payload'>): Record<string, string> {
  const out: Record<string, string> = {
    'instructions.md': p.payload.instructions,
    'agent.json': JSON.stringify({ name: p.payload.name, description: p.payload.description, tools: p.payload.tools, maxSteps: p.payload.maxSteps }, null, 2)
  }
  if (p.payload.skills.length) out['skills'] = p.payload.skills.join('\n')
  if (p.readme) out['README.md'] = p.readme
  return out
}

/** Keeps the note and time of every file that did not change, and stamps the ones that did. */
export function nextFileLog(prev: Record<string, FileLog>, p: Pick<ProjectDoc, 'readme' | 'payload'>, note: string, at: string): Record<string, FileLog> {
  const out: Record<string, FileLog> = {}
  for (const [name, text] of Object.entries(filesOf(p))) {
    const hash = sha(text)
    const bytes = Buffer.byteLength(text)
    out[name] = prev[name]?.hash === hash ? { ...prev[name]!, bytes } : { note, at, bytes, hash }
  }
  return out
}

const FILE_ORDER = ['skills', 'agent.json', 'instructions.md', 'README.md']

export function fileRows(files: Record<string, FileLog>): ProjectDetail['files'] {
  return Object.entries(files)
    .map(([name, f]) => ({ name, kind: name === 'skills' ? 'dir' as const : 'file' as const, note: f.note, at: f.at }))
    .sort((a, b) => FILE_ORDER.indexOf(a.name) - FILE_ORDER.indexOf(b.name))
}

/** The share of the project each part takes, by size, like the language bar on a code repository. */
export function madeOf(files: Record<string, FileLog>): ProjectDetail['made'] {
  const parts = [
    { label: 'Instructions', bytes: files['instructions.md']?.bytes ?? 0 },
    { label: 'Settings', bytes: (files['agent.json']?.bytes ?? 0) + (files['skills']?.bytes ?? 0) },
    { label: 'README', bytes: files['README.md']?.bytes ?? 0 }
  ].filter(p => p.bytes > 0)
  const total = parts.reduce((n, p) => n + p.bytes, 0)
  if (!total) return []
  const rows = parts.map(p => ({ label: p.label, pct: Math.max(1, Math.round((p.bytes / total) * 100)) }))
  // Rounding can leave 99 or 101: the biggest part takes the difference.
  const drift = 100 - rows.reduce((n, r) => n + r.pct, 0)
  rows.sort((a, b) => b.pct - a.pct)
  rows[0]!.pct += drift
  return rows
}

export interface InstallDeps {
  skills: Set<string>
  agentCount: (userId: string) => Promise<number>
  maxAgents: number
  createAgent: (userId: string, input: AgentInput, source: { shareId: string, version: number, author: string, project: string }) => Promise<Agent>
}

export function createProjectStore(db: TaskDb, profiles: Pick<ProfileStore, 'require' | 'get' | 'bump'>, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))().toISOString()
  const col = () => db.collection(PROJECTS)
  const ref = (id: string) => col().doc(id)
  const versions = () => db.collection(VERSIONS)
  const stars = () => db.collection(STARS)

  const load = async (id: string): Promise<ProjectDoc | null> => {
    const snap = await ref(id).get()
    return snap.exists ? fromDoc(snap.id, snap.data()) : null
  }
  const seen = (p: ProjectDoc | null, viewerId?: string | null): p is ProjectDoc => Boolean(p) && (!p!.hidden || p!.userId === viewerId)
  const need = (p: ProjectDoc | null, viewerId?: string | null): ProjectDoc => {
    if (!seen(p, viewerId)) throw new ReefError('That project does not exist, or it was taken down while it is looked at.', 'not_found')
    return p
  }

  let trendingCache: { at: number, ids: string[] } | undefined

  const store = {
    load,

    /** Publishes a new project, or a new version of one this person already has under that name. */
    async publish(userId: string, agent: Agent, raw: PublishInput): Promise<{ project: ProjectDoc, created: boolean }> {
      await assertNotDeleting(userId, db as any)
      const me = await profiles.require(userId)
      const parsed = publishSchema.safeParse(raw)
      if (!parsed.success) throw new ReefError(parsed.error.issues[0]!.message)
      const input = parsed.data
      const payload = payloadOf(agent)
      const description = input.description || payload.description
      const scan = scanText({ name: input.name, description, readme: input.readme, instructions: payload.instructions, note: input.note, tags: input.tags.join(' ') })
      if (scan.verdict === 'blocked') throw new ReefError('This cannot be shared yet. Fix what is listed and try again.', 'blocked', { scan })

      const id = projectIdOf(me.handle, input.name)
      const at = now()
      const needs = needsOf(payload)
      const mine = await db.collection(PROJECTS).where('userId', '==', userId).get()
      const result = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (snap.exists) {
          const cur = fromDoc(id, snap.data())
          if (cur.userId !== userId) throw new ReefError('That name is already used.', 'conflict')
          const version = cur.version + 1
          const note = input.note || `Version ${version}`
          const files = nextFileLog(cur.files, { readme: input.readme, payload }, note, at)
          const patch = { description, tags: input.tags, licence: input.licence, readme: input.readme, payload, needs, scan, version, note, files, updatedAt: at }
          tx.update(ref(id), patch)
          tx.set(versions().doc(`${id}__${version}`), { projectId: id, userId, version, note, description, readme: input.readme, payload, needs, scan, createdAt: at })
          return { project: fromDoc(id, { ...snap.data(), ...patch }), created: false }
        }
        if (mine.size >= LIMITS.projectsPerUser) throw new ReefError(`You can share up to ${LIMITS.projectsPerUser} projects. Remove one to add another.`, 'limit')
        const note = input.note || 'First version'
        const doc = {
          userId, owner: me.handle, name: input.name, kind: 'agent', description, tags: input.tags, licence: input.licence, readme: input.readme, payload, needs, scan,
          version: 1, note, stars: 0, forks: 0, installs: 0, hidden: false, forkedFrom: null, forkedFromId: null,
          files: nextFileLog({}, { readme: input.readme, payload }, note, at), createdAt: at, updatedAt: at
        }
        tx.set(ref(id), doc)
        tx.set(versions().doc(`${id}__1`), { projectId: id, userId, version: 1, note, description, readme: input.readme, payload, needs, scan, createdAt: at })
        return { project: fromDoc(id, doc), created: true }
      })
      if (result.created) await profiles.bump(userId, 'projects', 1)
      return result
    },

    /** A project as a stranger sees it, with its history. A hidden or missing one is "not found" for everyone but its owner. */
    async detail(owner: string, name: string, viewerId?: string | null): Promise<ProjectDetail> {
      const p = need(await load(projectIdOf(owner, name)), viewerId)
      const list = await versions().where('projectId', '==', p.id).orderBy('version', 'desc').limit(30).get()
      const history: ProjectVersion[] = (list.docs as any[]).map(d => ({ version: Number(d.data().version) || 0, note: String(d.data().note || ''), createdAt: String(d.data().createdAt || '') }))
      return {
        ...projectCard(p),
        readme: p.readme,
        instructions: p.payload.instructions,
        skills: p.payload.skills,
        needs: p.needs,
        scan: p.scan,
        versions: history,
        files: fileRows(p.files),
        made: madeOf(p.files),
        isOwner: Boolean(viewerId) && p.userId === viewerId,
        starred: viewerId ? (await stars().doc(`${viewerId}__${p.id}`).get()).exists : false
      }
    },

    /** The newest projects, or the most starred. Words and tags are matched in memory over the latest 300, which is enough until there is a real search service. */
    async list(o: { sort?: 'new' | 'stars', q?: string, tag?: string, before?: string, limit?: number } = {}): Promise<ProjectCard[]> {
      const limit = Math.min(o.limit ?? LIMITS.page, 50)
      const text = (o.q ?? '').trim().toLowerCase()
      const tag = o.tag ? tagOf(o.tag) : ''
      const filtering = Boolean(text || tag)
      let q = col().where('hidden', '==', false)
      q = o.sort === 'stars' ? q.orderBy('stars', 'desc') : q.orderBy('updatedAt', 'desc')
      if (o.before && o.sort !== 'stars') q = q.where('updatedAt', '<', o.before)
      const docs = (await q.limit(filtering ? 300 : limit).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as ProjectDoc[]
      const hit = (p: ProjectDoc) => (!tag || p.tags.includes(tag)) && (!text || `${p.owner}/${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(text))
      return docs.filter(hit).slice(0, limit).map(projectCard)
    },

    /** One person's projects. Their own list includes any that are hidden while being looked at. */
    async listByOwner(owner: string, viewerId?: string | null): Promise<ProjectCard[]> {
      const docs = (await col().where('owner', '==', owner).orderBy('updatedAt', 'desc').limit(60).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as ProjectDoc[]
      return docs.filter(p => !p.hidden || p.userId === viewerId).map(projectCard)
    },

    async listForks(owner: string, name: string): Promise<ProjectCard[]> {
      const docs = (await col().where('forkedFromId', '==', projectIdOf(owner, name)).limit(60).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as ProjectDoc[]
      return docs.filter(p => !p.hidden).sort((a, b) => b.stars - a.stars).map(projectCard)
    },

    async remove(userId: string, owner: string, name: string): Promise<void> {
      const p = need(await load(projectIdOf(owner, name)), userId)
      if (p.userId !== userId) throw new ReefError('That is not your project.', 'forbidden')
      const vs = await versions().where('projectId', '==', p.id).get()
      await Promise.all((vs.docs as any[]).map(d => d.ref.delete()))
      const ss = await stars().where('projectId', '==', p.id).get()
      await Promise.all((ss.docs as any[]).map(d => d.ref.delete()))
      await ref(p.id).delete()
      await profiles.bump(userId, 'projects', -1)
      if (p.stars) await profiles.bump(userId, 'starsEarned', -p.stars)
    },

    async star(userId: string, owner: string, name: string): Promise<{ starred: true, stars: number }> {
      await assertNotDeleting(userId, db as any)
      const me = await profiles.require(userId)
      const id = projectIdOf(owner, name)
      let notifyOwner = false
      const out = await db.runTransaction(async (tx: any) => {
        const p = await tx.get(ref(id))
        if (!p.exists || (p.data().hidden === true && p.data().userId !== userId)) throw new ReefError('That project does not exist.', 'not_found')
        const star = await tx.get(stars().doc(`${userId}__${id}`))
        const current = Number(p.data().stars) || 0
        if (star.exists) return current
        const ownerProfile = await tx.get(db.collection('reef_profiles').doc(String(p.data().userId)))
        tx.set(stars().doc(`${userId}__${id}`), { userId, projectId: id, createdAt: now() })
        tx.update(ref(id), { stars: current + 1 })
        if (ownerProfile.exists) tx.update(db.collection('reef_profiles').doc(String(p.data().userId)), { starsEarned: (Number(ownerProfile.data().starsEarned) || 0) + 1 })
        notifyOwner = p.data().userId !== userId
        return current + 1
      })
      if (notifyOwner) {
        const p = await load(id)
        if (p) await notify(db, { to: p.userId, type: 'star', actor: authorOf(me), targetType: 'project', targetId: `${owner}/${name}`, preview: '' }, now())
      }
      return { starred: true, stars: out as number }
    },

    async unstar(userId: string, owner: string, name: string): Promise<{ starred: false, stars: number }> {
      const id = projectIdOf(owner, name)
      const out = await db.runTransaction(async (tx: any) => {
        const p = await tx.get(ref(id))
        if (!p.exists) throw new ReefError('That project does not exist.', 'not_found')
        const star = await tx.get(stars().doc(`${userId}__${id}`))
        const current = Number(p.data().stars) || 0
        if (!star.exists) return current
        const ownerProfile = await tx.get(db.collection('reef_profiles').doc(String(p.data().userId)))
        tx.delete(stars().doc(`${userId}__${id}`))
        tx.update(ref(id), { stars: Math.max(0, current - 1) })
        if (ownerProfile.exists) tx.update(db.collection('reef_profiles').doc(String(p.data().userId)), { starsEarned: Math.max(0, (Number(ownerProfile.data().starsEarned) || 0) - 1) })
        return Math.max(0, current - 1)
      })
      return { starred: false, stars: out as number }
    },

    /** Of these projects, the ones this person starred. */
    async starredAmong(userId: string, projectIds: string[]): Promise<Set<string>> {
      const unique = [...new Set(projectIds)]
      const hits = await Promise.all(unique.map(async id => ((await stars().doc(`${userId}__${id}`).get()).exists ? id : null)))
      return new Set(hits.filter((x): x is string => Boolean(x)))
    },

    /** Projects a person starred, newest star first. */
    async listStarred(userId: string, viewerId?: string | null): Promise<ProjectCard[]> {
      const rows = (await stars().where('userId', '==', userId).get()).docs.map((d: any) => d.data()) as Array<{ projectId: string, createdAt: string }>
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const found = await Promise.all(rows.slice(0, 60).map(r => load(r.projectId)))
      return found.filter((p): p is ProjectDoc => seen(p, viewerId)).map(projectCard)
    },

    /** The projects people starred most in the last week, topped up with the most starred overall. Kept for ten minutes. */
    async trending(count = 3, days = 7): Promise<ProjectCard[]> {
      const at = Date.now()
      if (!trendingCache || at - trendingCache.at > 10 * 60_000) {
        const since = new Date(at - days * 86_400_000).toISOString()
        const rows = (await stars().where('createdAt', '>=', since).get()).docs.map((d: any) => String(d.data().projectId))
        const tally = new Map<string, number>()
        for (const id of rows) tally.set(id, (tally.get(id) ?? 0) + 1)
        const ids = [...tally].sort((a, b) => b[1] - a[1]).map(([id]) => id)
        trendingCache = { at, ids }
      }
      const picked: ProjectDoc[] = []
      for (const id of trendingCache.ids) {
        if (picked.length >= count) break
        const p = await load(id)
        if (p && !p.hidden) picked.push(p)
      }
      if (picked.length < count) {
        const top = (await col().where('hidden', '==', false).orderBy('stars', 'desc').limit(count + picked.length).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as ProjectDoc[]
        for (const p of top) if (picked.length < count && !picked.some(x => x.id === p.id)) picked.push(p)
      }
      return picked.map(projectCard)
    },

    /** Makes a copy of the project in the installer's account. Groups that reach into accounts stay off unless listed in `allow`. */
    async install(userId: string, owner: string, name: string, allow: string[], deps: InstallDeps) {
      await assertNotDeleting(userId, db as any)
      const p = need(await load(projectIdOf(owner, name)), userId)
      if (p.scan.verdict === 'blocked') throw new ReefError('This was flagged and cannot be installed.', 'blocked', { scan: p.scan })
      if ((await deps.agentCount(userId)) >= deps.maxAgents) throw new ReefError(`You can keep up to ${deps.maxAgents} agents. Delete one to add another.`, 'limit')
      const { input, withheld, droppedSkills } = agentFromShare(p.payload, allow, deps.skills)
      const author = (await profiles.get(p.userId))?.name ?? p.owner
      const agent = await deps.createAgent(userId, input, { shareId: p.id, version: p.version, author, project: `${p.owner}/${p.name}` })
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(p.id))
        if (snap.exists) tx.update(ref(p.id), { installs: (Number(snap.data().installs) || 0) + 1 })
      })
      return { agent, withheld, droppedSkills }
    },

    /** Your own copy of someone's project, under your handle, remembering where it came from. Not for "all rights reserved". */
    async fork(userId: string, owner: string, name: string, newName?: string): Promise<ProjectDoc> {
      await assertNotDeleting(userId, db as any)
      const me = await profiles.require(userId)
      const from = need(await load(projectIdOf(owner, name)), userId)
      if (from.userId === userId) throw new ReefError('This is already yours. Publish a new version instead.', 'conflict')
      if (from.licence === 'all-rights-reserved') throw new ReefError('The maker kept all rights, so this one can be installed but not forked.', 'forbidden')
      if (from.scan.verdict === 'blocked') throw new ReefError('This was flagged and cannot be forked.', 'blocked', { scan: from.scan })
      const parsed = publishSchema.shape.name.safeParse(newName || from.name)
      if (!parsed.success) throw new ReefError(parsed.error.issues[0]!.message)
      const id = projectIdOf(me.handle, parsed.data)
      const mine = await col().where('userId', '==', userId).get()
      if (mine.size >= LIMITS.projectsPerUser) throw new ReefError(`You can share up to ${LIMITS.projectsPerUser} projects. Remove one to add another.`, 'limit')
      const at = now()
      const note = `Forked from ${from.owner}/${from.name}`
      const doc = {
        userId, owner: me.handle, name: parsed.data, kind: 'agent', description: from.description, tags: from.tags, licence: from.licence, readme: from.readme, payload: from.payload, needs: from.needs, scan: from.scan,
        version: 1, note, stars: 0, forks: 0, installs: 0, hidden: false, forkedFrom: { owner: from.owner, name: from.name, version: from.version }, forkedFromId: from.id,
        files: nextFileLog({}, from, note, at), createdAt: at, updatedAt: at
      }
      await db.runTransaction(async (tx: any) => {
        if ((await tx.get(ref(id))).exists) throw new ReefError('You already have a project with that name. Pick another name for your copy.', 'conflict')
        const src = await tx.get(ref(from.id))
        if (!src.exists) throw new ReefError('That project does not exist.', 'not_found')
        tx.set(ref(id), doc)
        tx.set(versions().doc(`${id}__1`), { projectId: id, userId, version: 1, note, description: from.description, readme: from.readme, payload: from.payload, needs: from.needs, scan: from.scan, createdAt: at })
        tx.update(ref(from.id), { forks: (Number(src.data().forks) || 0) + 1 })
      })
      await profiles.bump(userId, 'projects', 1)
      await notify(db, { to: from.userId, type: 'fork', actor: authorOf(me), targetType: 'project', targetId: `${from.owner}/${from.name}`, preview: `${me.handle}/${parsed.data}`, unique: `${me.handle}__${parsed.data}` }, at)
      return fromDoc(id, doc)
    },

    /** Hides or shows a project. Used by reports and by the people who run The Reef. */
    async setHidden(id: string, hidden: boolean): Promise<void> {
      if (await load(id)) await ref(id).update({ hidden, updatedAt: now() })
    },

    /** Removes everything a person published and starred, for account deletion. */
    async forgetUser(userId: string): Promise<void> {
      const mine = (await col().where('userId', '==', userId).get()).docs as any[]
      for (const d of mine) {
        const vs = await versions().where('projectId', '==', d.id).get()
        await Promise.all((vs.docs as any[]).map(v => v.ref.delete()))
        const ss = await stars().where('projectId', '==', d.id).get()
        await Promise.all((ss.docs as any[]).map(s => s.ref.delete()))
        await d.ref.delete()
      }
      const given = (await stars().where('userId', '==', userId).get()).docs as any[]
      for (const s of given) {
        const pid = String(s.data().projectId)
        await db.runTransaction(async (tx: any) => {
          const p = await tx.get(ref(pid))
          if (p.exists) tx.update(ref(pid), { stars: Math.max(0, (Number(p.data().stars) || 0) - 1) })
        })
        await s.ref.delete()
      }
    }
  }
  return store
}

export type ProjectStore = ReturnType<typeof createProjectStore>
