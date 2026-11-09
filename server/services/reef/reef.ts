import { getFirebaseDb } from '../../utils/firebaseAdmin'
import type { TaskDb } from '../tasks/store'
import { createAlertStore } from './alerts'
import { createModeration } from './moderation'
import { createPostStore } from './posts'
import type { PostDoc } from './posts'
import { createProfileStore, authorOf } from './profiles'
import type { Author } from './profiles'
import { createProjectStore, projectCard } from './projects'
import type { ProjectCard } from './projects'

/**
 * The Reef, assembled: the stores and the step that turns stored documents into what a page shows
 * (a post with its author's name, its project, and whether the viewer liked it).
 */

export interface PostView {
  id: string
  type: PostDoc['type']
  author: Author
  text: string
  title: string
  tags: string[]
  createdAt: string
  likes: number
  replies: number
  liked: boolean
  mine: boolean
  /** A project shown under the post. `null` when it was removed. */
  project: (ProjectCard & { owner: string }) | null
  hasProject: boolean
  /** Questions: the answer that worked. */
  accepted: string | null
  /** Answers: this is the one that worked. */
  isAccepted: boolean
}

export function createReef(db: TaskDb, opts: { now?: () => Date } = {}) {
  const profiles = createProfileStore(db, opts)
  const projects = createProjectStore(db, profiles, opts)
  const posts = createPostStore(db, { profiles, projects }, opts)
  const alerts = createAlertStore(db)
  const moderation = createModeration(db, { projects, posts }, opts)

  /** Posts as pages show them. One lookup per distinct author and project, not per post. */
  async function postViews(list: PostDoc[], viewerId?: string | null, parent?: PostDoc | null): Promise<PostView[]> {
    const people = await profiles.getMany(list.map(p => p.userId))
    const projectIds = [...new Set(list.map(p => p.projectId).filter((x): x is string => Boolean(x)))]
    const loaded = new Map((await Promise.all(projectIds.map(async id => [id, await projects.load(id)] as const))))
    const liked = viewerId ? await posts.likedAmong(viewerId, list.map(p => p.id)) : new Set<string>()
    return list.map((p) => {
      const person = people.get(p.userId)
      const proj = p.projectId ? loaded.get(p.projectId) : null
      const visible = proj && (!proj.hidden || proj.userId === viewerId)
      return {
        id: p.id,
        type: p.type,
        author: person ? authorOf(person) : { handle: p.handle, name: p.handle, verified: false, official: false },
        text: p.text,
        title: p.title,
        tags: p.tags,
        createdAt: p.createdAt,
        likes: p.likes,
        replies: p.replies,
        liked: liked.has(p.id),
        mine: Boolean(viewerId) && p.userId === viewerId,
        project: visible ? projectCard(proj) : null,
        hasProject: Boolean(p.projectId),
        accepted: p.accepted,
        isAccepted: Boolean(parent?.accepted) && parent!.accepted === p.id
      }
    })
  }

  /** Everything a person did in The Reef, taken back (counts on other people's things included). Their own documents are swept after. */
  async function forgetUser(userId: string): Promise<void> {
    await moderation.forgetUser(userId)
    await posts.forgetUser(userId)
    await projects.forgetUser(userId)
    await profiles.forgetUser(userId)
  }

  return { profiles, projects, posts, alerts, moderation, postViews, forgetUser }
}

export type Reef = ReturnType<typeof createReef>

let shared: Reef | undefined
/** The live Reef, on the real database. */
export const reef = () => (shared ??= createReef(getFirebaseDb() as unknown as TaskDb))
