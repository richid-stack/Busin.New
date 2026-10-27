import { $fetch } from 'ofetch'
import type { ReefAlert, ReefMe, ReefProfile, ReefScan, ReefSide, PersonPage, PostView, ProjectCard, ProjectDetail, QueueItem } from '../types/reef'
import type { AgentProfile } from '../types/agents'
import { useCsrf } from './useCsrf'

/** What went wrong, in words a person can read, plus what the server said about the kind of problem. */
export class ReefApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly scan?: ReefScan) { super(message) }
  get notFound() { return this.status === 404 }
  /** The person is signed in but has not made their Reef profile yet. */
  get needsProfile() { return this.code === 'no_profile' }
}

function toError(err: any, fallback: string): ReefApiError {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status ?? 0
  const data = err?.data?.data ?? err?.data ?? {}
  const message = err?.data?.statusMessage || err?.data?.message || err?.statusMessage || (status === 401 ? 'Sign in to do that.' : fallback)
  return new ReefApiError(message, Number(status) || 0, String(data?.code ?? ''), data?.scan as ReefScan | undefined)
}

type Query = Record<string, string | number | undefined | null>

/** Every call to The Reef's API. Pages use these and never talk to `/api/reef` directly. */
export function useReef() {
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  async function call<T>(path: string, fallback: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, query?: Query } = {}): Promise<T> {
    const query = Object.fromEntries(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    try {
      return await $fetch<T>(`/api/reef${path}`, { method: opts.method ?? 'GET', headers: headers(), query, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}) })
    } catch (err) {
      throw toError(err, fallback)
    }
  }
  const e = encodeURIComponent
  const proj = (owner: string, name: string) => `/projects/${e(owner)}/${e(name)}`

  return {
    me: () => call<ReefMe>('/me', 'Could not load your profile.'),
    createProfile: (body: { handle: string, name?: string, bio?: string, place?: string }) => call<ReefProfile>('/profile', 'Could not save your profile.', { method: 'POST', body }),
    updateProfile: (body: { name?: string, bio?: string, place?: string }) => call<ReefProfile>('/profile', 'Could not save your profile.', { method: 'PUT', body }),
    person: (handle: string) => call<PersonPage>(`/people/${e(handle)}`, 'Could not load this person.'),
    follow: (handle: string) => call<{ following: true, followers: number }>(`/people/${e(handle)}/follow`, 'Could not follow.', { method: 'POST' }),
    unfollow: (handle: string) => call<{ following: false, followers: number }>(`/people/${e(handle)}/follow`, 'Could not unfollow.', { method: 'DELETE' }),
    personPosts: (handle: string, query: { kind?: 'posts' | 'questions', before?: string } = {}) => call<{ items: PostView[], next: string | null }>(`/people/${e(handle)}/posts`, 'Could not load posts.', { query }),
    personProjects: (handle: string) => call<{ items: ProjectCard[] }>(`/people/${e(handle)}/projects`, 'Could not load projects.'),
    personStars: (handle: string) => call<{ items: ProjectCard[] }>(`/people/${e(handle)}/stars`, 'Could not load stars.'),

    feed: (query: { tab: 'foryou' | 'following' | 'questions', before?: string }) => call<{ items: PostView[], next: string | null }>('/feed', 'Could not load the feed.', { query }),
    post: (body: { text: string, projectId?: string | null }) => call<PostView>('/posts', 'Could not post.', { method: 'POST', body }),
    getPost: (id: string) => call<{ post: PostView, replies: PostView[] }>(`/posts/${e(id)}`, 'Could not load this post.'),
    deletePost: (id: string) => call<{ success: boolean }>(`/posts/${e(id)}`, 'Could not delete.', { method: 'DELETE' }),
    reply: (id: string, text: string) => call<PostView>(`/posts/${e(id)}/replies`, 'Could not reply.', { method: 'POST', body: { text } }),
    like: (id: string) => call<{ liked: true, likes: number }>(`/posts/${e(id)}/like`, 'Could not like.', { method: 'POST' }),
    unlike: (id: string) => call<{ liked: false, likes: number }>(`/posts/${e(id)}/like`, 'Could not unlike.', { method: 'DELETE' }),
    accept: (answerId: string) => call<{ accepted: string }>(`/posts/${e(answerId)}/accept`, 'Could not mark the answer.', { method: 'POST' }),
    reportPost: (id: string, reason: string, note: string) => call<{ hidden: boolean }>(`/posts/${e(id)}/report`, 'Could not send the report.', { method: 'POST', body: { reason, note } }),

    questions: (query: { filter?: 'new' | 'unanswered' | 'solved', before?: string } = {}) => call<{ items: PostView[], next: string | null }>('/questions', 'Could not load questions.', { query }),
    ask: (body: { title: string, text?: string, tags?: string[], projectId?: string | null }) => call<PostView>('/questions', 'Could not post your question.', { method: 'POST', body }),

    projects: (query: { sort?: 'new' | 'stars', q?: string, tag?: string, before?: string } = {}) => call<{ items: ProjectCard[], next: string | null }>('/projects', 'Could not load projects.', { query }),
    publish: (body: { agentId: string, name: string, description?: string, tags?: string[], licence?: string, readme?: string, note?: string }) => call<{ created: boolean, project: ProjectCard }>('/projects', 'Could not share.', { method: 'POST', body }),
    project: (owner: string, name: string) => call<ProjectDetail>(proj(owner, name), 'Could not load this project.'),
    removeProject: (owner: string, name: string) => call<{ success: boolean }>(proj(owner, name), 'Could not remove.', { method: 'DELETE' }),
    star: (owner: string, name: string) => call<{ starred: true, stars: number }>(`${proj(owner, name)}/star`, 'Could not star.', { method: 'POST' }),
    unstar: (owner: string, name: string) => call<{ starred: false, stars: number }>(`${proj(owner, name)}/star`, 'Could not unstar.', { method: 'DELETE' }),
    install: (owner: string, name: string, allow: string[]) => call<{ agent: AgentProfile, withheld: Array<{ id: string, label: string }>, droppedSkills: string[] }>(`${proj(owner, name)}/install`, 'Could not add it. Try again.', { method: 'POST', body: { allow } }),
    fork: (owner: string, name: string, newName?: string) => call<ProjectCard>(`${proj(owner, name)}/fork`, 'Could not fork.', { method: 'POST', body: { name: newName } }),
    forks: (owner: string, name: string) => call<{ items: ProjectCard[] }>(`${proj(owner, name)}/forks`, 'Could not load forks.'),
    projectQuestions: (owner: string, name: string) => call<{ items: PostView[] }>(`${proj(owner, name)}/questions`, 'Could not load questions.'),
    reportProject: (owner: string, name: string, reason: string, note: string) => call<{ hidden: boolean }>(`${proj(owner, name)}/report`, 'Could not send the report.', { method: 'POST', body: { reason, note } }),

    side: () => call<ReefSide>('/side', 'Could not load.'),
    search: (q: string) => call<{ projects: ProjectCard[], people: Array<{ handle: string, name: string, verified: boolean, official: boolean }> }>('/search', 'Search failed.', { query: { q } }),
    alerts: () => call<{ items: ReefAlert[] }>('/alerts', 'Could not load alerts.'),
    readAlerts: () => call<{ success: boolean }>('/alerts/read', 'Could not update alerts.', { method: 'POST', body: {} }),

    queue: () => call<{ items: QueueItem[] }>('/admin/queue', 'Could not load the queue.'),
    resolve: (body: { targetType: 'project' | 'post', targetId: string, action: 'restore' | 'remove' }) => call<{ success: boolean }>('/admin/queue', 'Could not do that.', { method: 'POST', body }),
    badge: (body: { handle: string, verified?: boolean, official?: boolean }) => call<ReefProfile>('/admin/badges', 'Could not change the badge.', { method: 'POST', body })
  }
}

/** The address of a project's page, and a full address to send to someone. */
export const projectPath = (owner: string, name: string) => `/reef/${owner}/${name}`
export const projectUrl = (owner: string, name: string) => `${window.location.origin}${projectPath(owner, name)}`
export const postPath = (id: string) => `/reef/post/${id}`
export const postUrl = (id: string) => `${window.location.origin}${postPath(id)}`
