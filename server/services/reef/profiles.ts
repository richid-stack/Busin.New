import { assertNotDeleting } from '../account/tombstone'
import type { TaskDb } from '../tasks/store'
import { scanText } from './scan'
import { HANDLE_RE, LIMITS, RESERVED_HANDLES, ReefError, cleanText } from './model'
import { notify } from './alerts'

/**
 * People in The Reef. A person's profile is separate from their sign-in: it holds only what they chose to
 * show (a handle, a name, a short bio, a place) and the counts that go with it. Reading is open to
 * everyone; making a profile, following and posting need an account.
 */

export interface Profile {
  userId: string
  handle: string
  name: string
  bio: string
  place: string
  /** Handed out by hand to makers Richie knows. Never settable by the person. */
  verified: boolean
  /** The OpenLobs team's own accounts. */
  official: boolean
  followers: number
  following: number
  /** Stars on all of this person's projects. */
  starsEarned: number
  projects: number
  createdAt: string
}

/** What anyone sees. No account id. */
export type PublicProfile = Omit<Profile, 'userId'>
/** What a post or project shows next to a name. */
export interface Author { handle: string, name: string, verified: boolean, official: boolean }

export const publicProfile = (p: Profile): PublicProfile => {
  return { handle: p.handle, name: p.name, bio: p.bio, place: p.place, verified: p.verified, official: p.official, followers: p.followers, following: p.following, starsEarned: p.starsEarned, projects: p.projects, createdAt: p.createdAt }
}
export const authorOf = (p: Pick<Profile, 'handle' | 'name' | 'verified' | 'official'>): Author => ({ handle: p.handle, name: p.name, verified: p.verified, official: p.official })

export interface ProfileInput { handle: string, name: string, bio?: string, place?: string }

function fromDoc(d: Record<string, any>): Profile {
  return {
    userId: String(d.userId || ''),
    handle: String(d.handle || ''),
    name: String(d.name || ''),
    bio: String(d.bio || ''),
    place: String(d.place || ''),
    verified: d.verified === true,
    official: d.official === true,
    followers: Number(d.followers) || 0,
    following: Number(d.following) || 0,
    starsEarned: Number(d.starsEarned) || 0,
    projects: Number(d.projects) || 0,
    createdAt: String(d.createdAt || '')
  }
}

export const PROFILES = 'reef_profiles'
export const HANDLES = 'reef_handles'
export const FOLLOWS = 'reef_follows'

function checkedText(fields: { name: string, bio: string, place: string }) {
  const scan = scanText(fields)
  if (scan.verdict === 'blocked') throw new ReefError('Your profile has something that cannot be shown: ' + scan.findings[0]!.message, 'blocked', { scan })
}

function parseDetails(input: { name?: string, bio?: string, place?: string }, fallbackName = '') {
  const name = cleanText(input.name ?? fallbackName).replace(/\s+/g, ' ')
  if (!name) throw new ReefError('Give your name, or the name you want people to see.')
  if (name.length > LIMITS.nameMax) throw new ReefError(`Your name can be at most ${LIMITS.nameMax} characters.`)
  const bio = cleanText(input.bio ?? '')
  if (bio.length > LIMITS.bioMax) throw new ReefError(`Your bio can be at most ${LIMITS.bioMax} characters.`)
  const place = cleanText(input.place ?? '').replace(/\s+/g, ' ')
  if (place.length > LIMITS.placeMax) throw new ReefError(`Your place can be at most ${LIMITS.placeMax} characters.`)
  checkedText({ name, bio, place })
  return { name, bio, place }
}

export function normaliseHandle(raw: string): string {
  const handle = raw.trim().replace(/^@/, '').toLowerCase()
  if (!HANDLE_RE.test(handle)) throw new ReefError('A handle is 3 to 20 letters, numbers or underscores, and starts with a letter.')
  if (RESERVED_HANDLES.has(handle)) throw new ReefError('That handle is kept. Pick another.', 'taken')
  return handle
}

export function createProfileStore(db: TaskDb, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))().toISOString()
  const profiles = () => db.collection(PROFILES)
  const handles = () => db.collection(HANDLES)
  const follows = () => db.collection(FOLLOWS)

  const store = {
    async get(userId: string): Promise<Profile | null> {
      const snap = await profiles().doc(userId).get()
      return snap.exists ? fromDoc({ ...snap.data(), userId }) : null
    },

    async require(userId: string): Promise<Profile> {
      const p = await store.get(userId)
      if (!p) throw new ReefError('Set up your Reef profile first.', 'no_profile')
      return p
    },

    async getByHandle(handle: string): Promise<Profile | null> {
      const h = handle.trim().replace(/^@/, '').toLowerCase()
      if (!HANDLE_RE.test(h)) return null
      const snap = await handles().doc(h).get()
      if (!snap.exists) return null
      return store.get(String(snap.data().userId))
    },

    /** Several people at once, for the names on a page of posts. Missing ones are left out. */
    async getMany(userIds: string[]): Promise<Map<string, Profile>> {
      const unique = [...new Set(userIds)]
      const found = await Promise.all(unique.map(id => store.get(id)))
      return new Map(found.filter((p): p is Profile => Boolean(p)).map(p => [p.userId, p]))
    },

    /** Makes a person's profile and claims the handle in one step, so two people cannot get the same one. */
    async create(userId: string, input: ProfileInput, fallbackName = ''): Promise<Profile> {
      await assertNotDeleting(userId, db as any)
      const handle = normaliseHandle(input.handle)
      const details = parseDetails(input, fallbackName)
      const doc = { userId, handle, ...details, verified: false, official: false, followers: 0, following: 0, starsEarned: 0, projects: 0, createdAt: now() }
      await db.runTransaction(async (tx: any) => {
        const mine = await tx.get(profiles().doc(userId))
        if (mine.exists) throw new ReefError('You already have a Reef profile.', 'conflict')
        const taken = await tx.get(handles().doc(handle))
        if (taken.exists) throw new ReefError('That handle is taken. Try another.', 'taken')
        tx.set(handles().doc(handle), { userId, handle, createdAt: doc.createdAt })
        tx.set(profiles().doc(userId), doc)
      })
      return fromDoc(doc)
    },

    /** Changes what a person shows. The handle stays, because links to their projects use it. */
    async update(userId: string, input: { name?: string, bio?: string, place?: string }): Promise<Profile> {
      const cur = await store.require(userId)
      const details = parseDetails({ name: input.name ?? cur.name, bio: input.bio ?? cur.bio, place: input.place ?? cur.place })
      await profiles().doc(userId).update(details)
      return { ...cur, ...details }
    },

    /** Badges are given by hand by the people who run The Reef. */
    async setBadges(handle: string, badges: { verified?: boolean, official?: boolean }): Promise<Profile> {
      const p = await store.getByHandle(handle)
      if (!p) throw new ReefError('No one has that handle.', 'not_found')
      const patch: Record<string, boolean> = {}
      if (typeof badges.verified === 'boolean') patch.verified = badges.verified
      if (typeof badges.official === 'boolean') patch.official = badges.official
      if (Object.keys(patch).length) await profiles().doc(p.userId).update(patch)
      return { ...p, ...patch }
    },

    /** Claims a kept handle (like `openlobs`) for an account. Only the people who run The Reef call this. */
    async createReserved(userId: string, input: ProfileInput & { official?: boolean, verified?: boolean }): Promise<Profile> {
      const handle = input.handle.trim().replace(/^@/, '').toLowerCase()
      if (!HANDLE_RE.test(handle)) throw new ReefError('A handle is 3 to 20 letters, numbers or underscores, and starts with a letter.')
      const details = parseDetails(input)
      const doc = { userId, handle, ...details, verified: input.verified ?? true, official: input.official ?? true, followers: 0, following: 0, starsEarned: 0, projects: 0, createdAt: now() }
      await db.runTransaction(async (tx: any) => {
        if ((await tx.get(profiles().doc(userId))).exists) throw new ReefError('That account already has a profile.', 'conflict')
        if ((await tx.get(handles().doc(handle))).exists) throw new ReefError('That handle is taken.', 'taken')
        tx.set(handles().doc(handle), { userId, handle, createdAt: doc.createdAt })
        tx.set(profiles().doc(userId), doc)
      })
      return fromDoc(doc)
    },

    async follow(userId: string, handle: string): Promise<{ following: true, followers: number }> {
      await assertNotDeleting(userId, db as any)
      const me = await store.require(userId)
      const target = await store.getByHandle(handle)
      if (!target) throw new ReefError('No one has that handle.', 'not_found')
      if (target.userId === userId) throw new ReefError('You cannot follow yourself.')
      const id = `${userId}__${target.userId}`
      const followers = await db.runTransaction(async (tx: any) => {
        const existing = await tx.get(follows().doc(id))
        const mine = await tx.get(profiles().doc(userId))
        const theirs = await tx.get(profiles().doc(target.userId))
        if (!theirs.exists || !mine.exists) throw new ReefError('No one has that handle.', 'not_found')
        const current = Number(theirs.data().followers) || 0
        if (existing.exists) return current
        tx.set(follows().doc(id), { userId, followeeId: target.userId, createdAt: now() })
        tx.update(profiles().doc(target.userId), { followers: current + 1 })
        tx.update(profiles().doc(userId), { following: (Number(mine.data().following) || 0) + 1 })
        return current + 1
      })
      await notify(db, { to: target.userId, type: 'follow', actor: authorOf(me), targetType: 'profile', targetId: me.handle, preview: '' }, now())
      return { following: true, followers: followers as number }
    },

    async unfollow(userId: string, handle: string): Promise<{ following: false, followers: number }> {
      const target = await store.getByHandle(handle)
      if (!target) throw new ReefError('No one has that handle.', 'not_found')
      const id = `${userId}__${target.userId}`
      const followers = await db.runTransaction(async (tx: any) => {
        const existing = await tx.get(follows().doc(id))
        const mine = await tx.get(profiles().doc(userId))
        const theirs = await tx.get(profiles().doc(target.userId))
        const current = theirs.exists ? Number(theirs.data().followers) || 0 : 0
        if (!existing.exists) return current
        tx.delete(follows().doc(id))
        if (theirs.exists) tx.update(profiles().doc(target.userId), { followers: Math.max(0, current - 1) })
        if (mine.exists) tx.update(profiles().doc(userId), { following: Math.max(0, (Number(mine.data().following) || 0) - 1) })
        return Math.max(0, current - 1)
      })
      return { following: false, followers: followers as number }
    },

    /** Ids of the people this person follows, most recent first. */
    async followingIds(userId: string, max: number = LIMITS.followingFeedMax): Promise<string[]> {
      const snap = await follows().where('userId', '==', userId).get()
      return (snap.docs as any[]).map(d => d.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, max).map(d => String(d.followeeId))
    },

    /** Which of these people the viewer follows. */
    async followedAmong(userId: string, otherIds: string[]): Promise<Set<string>> {
      const unique = [...new Set(otherIds)].filter(id => id !== userId)
      const hits = await Promise.all(unique.map(async id => ((await follows().doc(`${userId}__${id}`).get()).exists ? id : null)))
      return new Set(hits.filter((x): x is string => Boolean(x)))
    },

    /** People worth following: the most followed, minus the viewer and anyone they already follow. */
    async suggestions(viewerId: string | null, count = 3): Promise<Profile[]> {
      const top = (await profiles().orderBy('followers', 'desc').limit(30).get()).docs.map((d: any) => fromDoc({ ...d.data(), userId: d.id })) as Profile[]
      const followed = viewerId ? await store.followedAmong(viewerId, top.map(p => p.userId)) : new Set<string>()
      return top.filter(p => p.userId !== viewerId && !followed.has(p.userId) && !p.official).slice(0, count)
    },

    /** People whose handle starts with the text. A name search needs a real search service later. */
    async searchHandles(text: string, count = 5): Promise<Profile[]> {
      const q = text.trim().replace(/^@/, '').toLowerCase()
      if (q.length < 1 || q.length > 20) return []
      const snap = await handles().where('handle', '>=', q).where('handle', '<=', `${q}`).limit(count).get()
      const found = await Promise.all((snap.docs as any[]).map(d => store.get(String(d.data().userId))))
      return found.filter((p): p is Profile => Boolean(p))
    },

    /** For account deletion: takes back the follows this person gave and received, so other people's counts stay right. */
    async forgetUser(userId: string): Promise<void> {
      const given = (await follows().where('userId', '==', userId).get()).docs as any[]
      for (const f of given) {
        const other = String(f.data().followeeId)
        await db.runTransaction(async (tx: any) => {
          const snap = await tx.get(profiles().doc(other))
          if (snap.exists) tx.update(profiles().doc(other), { followers: Math.max(0, (Number(snap.data().followers) || 0) - 1) })
        })
        await f.ref.delete()
      }
      const received = (await follows().where('followeeId', '==', userId).get()).docs as any[]
      for (const f of received) {
        const other = String(f.data().userId)
        await db.runTransaction(async (tx: any) => {
          const snap = await tx.get(profiles().doc(other))
          if (snap.exists) tx.update(profiles().doc(other), { following: Math.max(0, (Number(snap.data().following) || 0) - 1) })
        })
        await f.ref.delete()
      }
    },

    /** Moves a counter on a profile by a small amount, never below zero. Used by the project and star code. */
    async bump(userId: string, field: 'projects' | 'starsEarned', by: number): Promise<void> {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(profiles().doc(userId))
        if (!snap.exists) return
        tx.update(profiles().doc(userId), { [field]: Math.max(0, (Number(snap.data()[field]) || 0) + by) })
      })
    }
  }
  return store
}

export type ProfileStore = ReturnType<typeof createProfileStore>
