import { z } from 'zod'
import { assertNotDeleting } from '../account/tombstone'
import type { TaskDb } from '../tasks/store'
import { scanText } from './scan'
import { LIMITS, ReefError, chunk, cleanText, tagOf } from './model'
import { notify } from './alerts'
import { authorOf } from './profiles'
import type { ProfileStore } from './profiles'
import type { ProjectStore } from './projects'

/**
 * Posts, questions and replies. They share one collection because they share one life: someone writes,
 * others like or answer, and a signed-in person can delete their own. A top-level post or question shows
 * up in the feed; a reply or answer lives under it.
 */

export const POSTS = 'reef_posts'
export const LIKES = 'reef_likes'

export type PostType = 'post' | 'question' | 'reply' | 'answer'

export interface PostDoc {
  id: string
  userId: string
  handle: string
  type: PostType
  text: string
  /** Questions only: the headline. */
  title: string
  tags: string[]
  /** A project shown under the post ("owner__name"). */
  projectId: string | null
  /** The post or question this one answers. */
  replyTo: string | null
  /** In the home feed. False for replies and for anything hidden. */
  feed: boolean
  /** In the list of questions. */
  qlist: boolean
  hidden: boolean
  /** The scan wanted a human to look at it. */
  flagged: boolean
  likes: number
  replies: number
  /** Questions: the answer the asker marked as the one that worked. */
  accepted: string | null
  createdAt: string
}

function fromDoc(id: string, d: Record<string, any>): PostDoc {
  return {
    id,
    userId: String(d.userId || ''),
    handle: String(d.handle || ''),
    type: (['post', 'question', 'reply', 'answer'] as const).includes(d.type) ? d.type : 'post',
    text: String(d.text || ''),
    title: String(d.title || ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    projectId: d.projectId ? String(d.projectId) : null,
    replyTo: d.replyTo ? String(d.replyTo) : null,
    feed: d.feed === true,
    qlist: d.qlist === true,
    hidden: d.hidden === true,
    flagged: d.flagged === true,
    likes: Number(d.likes) || 0,
    replies: Number(d.replies) || 0,
    accepted: d.accepted ? String(d.accepted) : null,
    createdAt: String(d.createdAt || '')
  }
}

const body = (max: number, what: string) => z.string().transform(cleanText).pipe(z.string().min(1, `Write something first.`).max(max, `${what} can be at most ${max} characters.`))

export const postSchema = z.object({ text: body(LIMITS.postMax, 'A post'), projectId: z.string().max(100).nullish() })
export const questionSchema = z.object({
  title: z.string().transform(s => cleanText(s).replace(/\s+/g, ' ')).pipe(z.string().min(8, 'Ask it as a question, in a few words.').max(140, 'The question can be at most 140 characters.')),
  text: z.string().transform(cleanText).pipe(z.string().max(2000, 'The details can be at most 2000 characters.')).default(''),
  tags: z.array(z.string()).max(10).default([]).transform(list => [...new Set(list.map(tagOf).filter(Boolean))].slice(0, 4)),
  projectId: z.string().max(100).nullish()
})
export const replySchema = z.object({ text: body(1000, 'A reply') })

export type FeedTab = 'foryou' | 'following' | 'questions'

export function createPostStore(db: TaskDb, deps: { profiles: Pick<ProfileStore, 'require' | 'get' | 'followingIds'>, projects: Pick<ProjectStore, 'load'> }, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))().toISOString()
  const col = () => db.collection(POSTS)
  const ref = (id: string) => col().doc(id)
  const likes = () => db.collection(LIKES)
  const load = async (id: string) => { const s = await ref(id).get(); return s.exists ? fromDoc(s.id, s.data()) : null }
  const visibleTo = (p: PostDoc | null, viewerId?: string | null): p is PostDoc => Boolean(p) && (!p!.hidden || p!.userId === viewerId)
  const rows = (snap: any) => (snap.docs as any[]).map(d => fromDoc(d.id, d.data()))

  const check = (fields: Record<string, string>) => {
    const scan = scanText(fields)
    if (scan.verdict === 'blocked') throw new ReefError('This cannot be posted: ' + scan.findings[0]!.message, 'blocked', { scan })
    return scan.verdict === 'review'
  }
  const attach = async (projectId: string | null | undefined, viewerId: string) => {
    if (!projectId) return null
    const p = await deps.projects.load(projectId)
    if (!p || (p.hidden && p.userId !== viewerId)) throw new ReefError('That project does not exist.', 'not_found')
    return p.id
  }

  const store = {
    load,

    async create(userId: string, raw: z.input<typeof postSchema>): Promise<PostDoc> {
      await assertNotDeleting(userId, db as any)
      const me = await deps.profiles.require(userId)
      const parsed = postSchema.safeParse(raw)
      if (!parsed.success) throw new ReefError(parsed.error.issues[0]!.message)
      const flagged = check({ text: parsed.data.text })
      const projectId = await attach(parsed.data.projectId, userId)
      const doc = { userId, handle: me.handle, type: 'post', text: parsed.data.text, title: '', tags: [], projectId, replyTo: null, feed: true, qlist: false, hidden: false, flagged, likes: 0, replies: 0, accepted: null, createdAt: now() }
      const r = col().doc()
      await r.set(doc)
      return fromDoc(r.id, doc)
    },

    async ask(userId: string, raw: z.input<typeof questionSchema>): Promise<PostDoc> {
      await assertNotDeleting(userId, db as any)
      const me = await deps.profiles.require(userId)
      const parsed = questionSchema.safeParse(raw)
      if (!parsed.success) throw new ReefError(parsed.error.issues[0]!.message)
      const q = parsed.data
      const flagged = check({ title: q.title, text: q.text, tags: q.tags.join(' ') })
      const projectId = await attach(q.projectId, userId)
      const doc = { userId, handle: me.handle, type: 'question', text: q.text, title: q.title, tags: q.tags, projectId, replyTo: null, feed: true, qlist: true, hidden: false, flagged, likes: 0, replies: 0, accepted: null, createdAt: now() }
      const r = col().doc()
      await r.set(doc)
      return fromDoc(r.id, doc)
    },

    /** A reply to a post, or an answer to a question. Replies sit one level under the post. */
    async reply(userId: string, parentId: string, raw: z.input<typeof replySchema>): Promise<PostDoc> {
      await assertNotDeleting(userId, db as any)
      const me = await deps.profiles.require(userId)
      const parsed = replySchema.safeParse(raw)
      if (!parsed.success) throw new ReefError(parsed.error.issues[0]!.message)
      const flagged = check({ text: parsed.data.text })
      const at = now()
      const r = col().doc()
      const made = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(parentId))
        if (!snap.exists) throw new ReefError('That post does not exist.', 'not_found')
        const parent = fromDoc(parentId, snap.data())
        if (parent.hidden && parent.userId !== userId) throw new ReefError('That post does not exist.', 'not_found')
        if (parent.replyTo) throw new ReefError('Reply to the post itself, so the conversation stays in one place.')
        const type: PostType = parent.type === 'question' ? 'answer' : 'reply'
        const doc = { userId, handle: me.handle, type, text: parsed.data.text, title: '', tags: [], projectId: null, replyTo: parentId, feed: false, qlist: false, hidden: false, flagged, likes: 0, replies: 0, accepted: null, createdAt: at }
        tx.set(r, doc)
        tx.update(ref(parentId), { replies: parent.replies + 1 })
        return { doc, parent }
      })
      await notify(db, { to: made.parent.userId, type: made.doc.type === 'answer' ? 'answer' : 'reply', actor: authorOf(me), targetType: 'post', targetId: parentId, preview: made.parent.title || made.parent.text, unique: r.id }, at)
      return fromDoc(r.id, made.doc)
    },

    /** The asker marks the answer that worked. Choosing another answer moves the mark. */
    async accept(userId: string, answerId: string): Promise<{ accepted: string }> {
      const me = await deps.profiles.require(userId)
      const answer = await load(answerId)
      if (!answer || answer.type !== 'answer' || !answer.replyTo) throw new ReefError('That answer does not exist.', 'not_found')
      const question = await load(answer.replyTo)
      if (!question) throw new ReefError('That question does not exist.', 'not_found')
      if (question.userId !== userId) throw new ReefError('Only the person who asked can mark the answer that worked.', 'forbidden')
      await ref(question.id).update({ accepted: answerId })
      if (answer.userId !== userId) await notify(db, { to: answer.userId, type: 'accepted', actor: authorOf(me), targetType: 'post', targetId: question.id, preview: question.title, unique: answerId }, now())
      return { accepted: answerId }
    },

    async get(id: string, viewerId?: string | null): Promise<PostDoc> {
      const p = await load(id)
      if (!visibleTo(p, viewerId)) throw new ReefError('That post does not exist, or it was taken down.', 'not_found')
      return p
    },

    /** The home feed. "Following" gathers recent posts from the people you follow (up to the first 50 of them). */
    async feed(o: { tab: FeedTab, viewerId?: string | null, before?: string, limit?: number }): Promise<PostDoc[]> {
      const limit = Math.min(o.limit ?? LIMITS.page, 50)
      if (o.tab === 'following') {
        if (!o.viewerId) return []
        const ids = await deps.profiles.followingIds(o.viewerId, LIMITS.followingFeedMax)
        if (!ids.length) return []
        const parts = await Promise.all(chunk(ids, 10).map(async (group) => {
          let q = col().where('userId', 'in', group).where('feed', '==', true).orderBy('createdAt', 'desc')
          if (o.before) q = q.where('createdAt', '<', o.before)
          return rows(await q.limit(limit).get())
        }))
        return parts.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      }
      let q = col().where(o.tab === 'questions' ? 'qlist' : 'feed', '==', true).orderBy('createdAt', 'desc')
      if (o.before) q = q.where('createdAt', '<', o.before)
      return rows(await q.limit(limit).get())
    },

    /** The questions page: newest first, or only the unanswered, or only the solved. */
    async questions(o: { filter?: 'new' | 'unanswered' | 'solved', before?: string, limit?: number } = {}): Promise<PostDoc[]> {
      const limit = Math.min(o.limit ?? LIMITS.page, 50)
      let q = col().where('qlist', '==', true).orderBy('createdAt', 'desc')
      if (o.before) q = q.where('createdAt', '<', o.before)
      const narrow = o.filter === 'unanswered' || o.filter === 'solved'
      const list = rows(await q.limit(narrow ? limit * 4 : limit).get())
      const keep = o.filter === 'unanswered' ? list.filter(p => p.replies === 0) : o.filter === 'solved' ? list.filter(p => p.accepted) : list
      return keep.slice(0, limit)
    },

    /** Open questions for the side column: not solved, newest first. */
    async openQuestions(count = 3): Promise<PostDoc[]> {
      const list = rows(await col().where('qlist', '==', true).orderBy('createdAt', 'desc').limit(30).get())
      return list.filter(p => !p.accepted).slice(0, count)
    },

    async byUser(userId: string, o: { kind?: 'posts' | 'questions', before?: string, limit?: number } = {}): Promise<PostDoc[]> {
      const limit = Math.min(o.limit ?? LIMITS.page, 50)
      let q = col().where('userId', '==', userId).where('feed', '==', true).orderBy('createdAt', 'desc')
      if (o.before) q = q.where('createdAt', '<', o.before)
      const list = rows(await q.limit(o.kind === 'questions' ? limit * 3 : limit).get())
      return (o.kind === 'questions' ? list.filter(p => p.type === 'question') : list).slice(0, limit)
    },

    /** Posts that point at a project, for its Questions tab. */
    async questionsAbout(projectId: string, limit = 30): Promise<PostDoc[]> {
      const list = rows(await col().where('projectId', '==', projectId).limit(100).get())
      return list.filter(p => p.type === 'question' && !p.hidden).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    },

    /** Replies under a post. On a question the marked answer comes first. */
    async replies(parentId: string, viewerId?: string | null): Promise<PostDoc[]> {
      const parent = await load(parentId)
      const list = rows(await col().where('replyTo', '==', parentId).orderBy('createdAt', 'asc').limit(100).get()).filter(p => !p.hidden || p.userId === viewerId)
      if (!parent?.accepted) return list
      return [...list.filter(p => p.id === parent.accepted), ...list.filter(p => p.id !== parent.accepted)]
    },

    async like(userId: string, id: string): Promise<{ liked: true, likes: number }> {
      await assertNotDeleting(userId, db as any)
      const me = await deps.profiles.require(userId)
      let owner = ''
      let preview = ''
      const total = await db.runTransaction(async (tx: any) => {
        const post = await tx.get(ref(id))
        if (!post.exists || (post.data().hidden === true && post.data().userId !== userId)) throw new ReefError('That post does not exist.', 'not_found')
        const like = await tx.get(likes().doc(`${userId}__${id}`))
        const current = Number(post.data().likes) || 0
        if (like.exists) return current
        tx.set(likes().doc(`${userId}__${id}`), { userId, postId: id, createdAt: now() })
        tx.update(ref(id), { likes: current + 1 })
        owner = String(post.data().userId)
        preview = String(post.data().title || post.data().text || '')
        return current + 1
      })
      if (owner && owner !== userId) await notify(db, { to: owner, type: 'like', actor: authorOf(me), targetType: 'post', targetId: id, preview }, now())
      return { liked: true, likes: total as number }
    },

    async unlike(userId: string, id: string): Promise<{ liked: false, likes: number }> {
      const total = await db.runTransaction(async (tx: any) => {
        const post = await tx.get(ref(id))
        if (!post.exists) throw new ReefError('That post does not exist.', 'not_found')
        const like = await tx.get(likes().doc(`${userId}__${id}`))
        const current = Number(post.data().likes) || 0
        if (!like.exists) return current
        tx.delete(likes().doc(`${userId}__${id}`))
        tx.update(ref(id), { likes: Math.max(0, current - 1) })
        return Math.max(0, current - 1)
      })
      return { liked: false, likes: total as number }
    },

    async likedAmong(userId: string, postIds: string[]): Promise<Set<string>> {
      const unique = [...new Set(postIds)]
      const hits = await Promise.all(unique.map(async id => ((await likes().doc(`${userId}__${id}`).get()).exists ? id : null)))
      return new Set(hits.filter((x): x is string => Boolean(x)))
    },

    /** Deletes a post of one's own, with the replies under it. */
    async remove(userId: string, id: string): Promise<void> {
      const p = await load(id)
      if (!p || p.userId !== userId) throw new ReefError('That post does not exist.', 'not_found')
      if (p.replyTo) {
        await db.runTransaction(async (tx: any) => {
          const parent = await tx.get(ref(p.replyTo!))
          if (parent.exists) tx.update(ref(p.replyTo!), { replies: Math.max(0, (Number(parent.data().replies) || 0) - 1), ...(parent.data().accepted === id ? { accepted: null } : {}) })
        })
      }
      const below = rows(await col().where('replyTo', '==', id).get())
      for (const r of below) await ref(r.id).delete()
      const ls = await likes().where('postId', '==', id).get()
      await Promise.all((ls.docs as any[]).map(d => d.ref.delete()))
      await ref(id).delete()
    },

    /** Hides or shows a post. Used by reports and by the people who run The Reef. */
    async setHidden(id: string, hidden: boolean): Promise<void> {
      const p = await load(id)
      if (!p) return
      await ref(id).update({ hidden, feed: !hidden && !p.replyTo, qlist: !hidden && p.type === 'question' })
    },

    /** Removes everything a person wrote and liked, for account deletion. */
    async forgetUser(userId: string): Promise<void> {
      const mine = rows(await col().where('userId', '==', userId).get())
      for (const p of mine) {
        if (!(await load(p.id))) continue
        await store.remove(userId, p.id).catch(() => {})
      }
      const given = (await likes().where('userId', '==', userId).get()).docs as any[]
      for (const l of given) {
        const pid = String(l.data().postId)
        await db.runTransaction(async (tx: any) => {
          const p = await tx.get(ref(pid))
          if (p.exists) tx.update(ref(pid), { likes: Math.max(0, (Number(p.data().likes) || 0) - 1) })
        })
        await l.ref.delete()
      }
    }
  }
  return store
}

export type PostStore = ReturnType<typeof createPostStore>
