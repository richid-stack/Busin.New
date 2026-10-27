import { H3Event } from 'nitro/h3'
import { useFirebaseAuthForTests, useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { createAgent } from '../server/services/agents/store'
import { agentInputSchema } from '../server/services/agents/profile'

import meGet from '../server/routes/api/reef/me.get'
import profilePost from '../server/routes/api/reef/profile.post'
import profilePut from '../server/routes/api/reef/profile.put'
import personGet from '../server/routes/api/reef/people/[handle].get'
import followPost from '../server/routes/api/reef/people/[handle]/follow.post'
import followDelete from '../server/routes/api/reef/people/[handle]/follow.delete'
import personPosts from '../server/routes/api/reef/people/[handle]/posts.get'
import personProjects from '../server/routes/api/reef/people/[handle]/projects.get'
import feedGet from '../server/routes/api/reef/feed.get'
import postsPost from '../server/routes/api/reef/posts.post'
import postGet from '../server/routes/api/reef/posts/[id].get'
import postDelete from '../server/routes/api/reef/posts/[id].delete'
import replyPost from '../server/routes/api/reef/posts/[id]/replies.post'
import likePost from '../server/routes/api/reef/posts/[id]/like.post'
import likeDelete from '../server/routes/api/reef/posts/[id]/like.delete'
import acceptPost from '../server/routes/api/reef/posts/[id]/accept.post'
import postReport from '../server/routes/api/reef/posts/[id]/report.post'
import questionsGet from '../server/routes/api/reef/questions.get'
import questionsPost from '../server/routes/api/reef/questions.post'
import projectsGet from '../server/routes/api/reef/projects.get'
import projectsPost from '../server/routes/api/reef/projects.post'
import projectGet from '../server/routes/api/reef/projects/[owner]/[name].get'
import projectDelete from '../server/routes/api/reef/projects/[owner]/[name].delete'
import starPost from '../server/routes/api/reef/projects/[owner]/[name]/star.post'
import starDelete from '../server/routes/api/reef/projects/[owner]/[name]/star.delete'
import forkPost from '../server/routes/api/reef/projects/[owner]/[name]/fork.post'
import forksGet from '../server/routes/api/reef/projects/[owner]/[name]/forks.get'
import projectQuestions from '../server/routes/api/reef/projects/[owner]/[name]/questions.get'
import projectReport from '../server/routes/api/reef/projects/[owner]/[name]/report.post'
import sideGet from '../server/routes/api/reef/side.get'
import searchGet from '../server/routes/api/reef/search.get'
import alertsGet from '../server/routes/api/reef/alerts.get'
import alertsRead from '../server/routes/api/reef/alerts/read.post'
import queueGet from '../server/routes/api/reef/admin/queue.get'
import queuePost from '../server/routes/api/reef/admin/queue.post'
import badgesPost from '../server/routes/api/reef/admin/badges.post'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const db = createFakeFirestore()
useFirebaseDbForTests(db as any)
// A token is just the person's id; "verifying" it gives that person back.
useFirebaseAuthForTests({ verifyIdToken: async (token: string) => ({ uid: token, name: token === 'richie' ? 'Richie' : `Name ${token}`, email: `${token}@example.com`, exp: Date.now() / 1000 + 3600, auth_time: Date.now() / 1000 }) })
process.env.REEF_ADMINS = 'richie@example.com'

type Call = { user?: string, params?: Record<string, string>, query?: Record<string, string>, body?: unknown }
const call = async (handler: any, c: Call = {}): Promise<{ status: number, body: any }> => {
  const url = new URL('http://localhost/api/reef/x')
  for (const [k, v] of Object.entries(c.query ?? {})) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (c.user) headers.authorization = `Bearer ${c.user}`
  if (c.body !== undefined) headers['content-type'] = 'application/json'
  const req = new Request(url, { method: c.body !== undefined ? 'POST' : 'GET', headers, body: c.body !== undefined ? JSON.stringify(c.body) : undefined })
  const event = new (H3Event as any)(req)
  event.context.params = c.params ?? {}
  try {
    const out = await handler(event)
    return { status: 200, body: JSON.parse(JSON.stringify(out ?? null)) }
  } catch (e: any) {
    return { status: e.status ?? e.statusCode ?? 500, body: { message: e.statusText ?? e.statusMessage ?? e.message, data: e.data } }
  }
}

const agentFor = async (userId: string, over: Record<string, unknown> = {}) => createAgent(userId, agentInputSchema.parse({ name: 'Shop assistant', description: 'Answers customers.', instructions: 'Answer customer messages. Ask before any refund.', tools: ['web', 'apps'], skills: [], maxSteps: 8, ...over }))

// ---- signed out ----
assert((await call(meGet)).body.signedIn === false, 'signed out: /me says so')
for (const [name, h] of [['profile', profilePost], ['post', postsPost], ['question', questionsPost], ['project', projectsPost], ['alerts', alertsGet]] as const) {
  assert((await call(h, { body: {} })).status === 401, `signed out: ${name} needs an account`)
}
assert((await call(feedGet)).status === 200 && (await call(projectsGet)).status === 200 && (await call(questionsGet)).status === 200 && (await call(sideGet)).status === 200, 'signed out: the feed, projects, questions and side column can be read')

// ---- a profile ----
const nobody = await call(postsPost, { user: 'ama', body: { text: 'hi' } })
assert(nobody.status === 409 && nobody.body.data.code === 'no_profile', 'posting before having a profile says to make one (409, code no_profile)')
assert((await call(meGet, { user: 'ama' })).body.profile === null, '/me: signed in with no profile yet')
const made = await call(profilePost, { user: 'ama', body: { handle: 'Ama', bio: 'Runs a shop' } })
assert(made.status === 200 && made.body.handle === 'ama' && made.body.name === 'Name ama' && !('userId' in made.body), 'making a profile defaults the name to the account name and shows no account id')
assert((await call(profilePost, { user: 'kwesi', body: { handle: 'ama' } })).status === 409 && (await call(profilePost, { user: 'kwesi', body: { handle: 'x' } })).status === 400, 'a taken or invalid handle is refused with a clear status')
assert((await call(profilePut, { user: 'ama', body: { bio: 'Updated' } })).body.bio === 'Updated', 'a profile can be updated')
await call(profilePost, { user: 'kwesi', body: { handle: 'kwesi', name: 'Kwesi Mensah' } })
await call(profilePost, { user: 'efua', body: { handle: 'efua' } })
await call(profilePost, { user: 'richie', body: { handle: 'richie', name: 'Richie' } })
const me = (await call(meGet, { user: 'richie' })).body
assert(me.profile.handle === 'richie' && me.admin === true && (await call(meGet, { user: 'ama' })).body.admin === false, '/me says who runs The Reef')

// ---- admin hides ----
assert((await call(queueGet, { user: 'ama' })).status === 404 && (await call(badgesPost, { user: 'ama', body: { handle: 'ama', verified: true } })).status === 404 && (await call(queueGet)).status === 401, 'the queue and badges are invisible to everyone else')
const badge = await call(badgesPost, { user: 'richie', body: { handle: 'kwesi', verified: true } })
assert(badge.status === 200 && badge.body.verified === true, 'an admin hands out a verified badge')

// ---- people ----
const person = await call(personGet, { user: 'ama', params: { handle: 'kwesi' } })
assert(person.body.verified && person.body.viewerFollows === false && person.body.following === 0 && person.body.isMe === false && (await call(personGet, { params: { handle: 'nobody' } })).status === 404, 'a profile page tells the viewer whether they follow; unknown handle is 404')
assert((await call(followPost, { user: 'ama', params: { handle: 'kwesi' } })).body.followers === 1 && (await call(personGet, { user: 'ama', params: { handle: 'kwesi' } })).body.viewerFollows === true, 'following works and shows')
assert((await call(followPost, { user: 'ama', params: { handle: 'ama' } })).status === 400, 'following yourself is a 400')
assert((await call(followDelete, { user: 'ama', params: { handle: 'kwesi' } })).body.followers === 0 && (await call(personGet, { user: 'ama', params: { handle: 'kwesi' } })).body.viewerFollows === false, 'unfollowing works and shows')
await call(followPost, { user: 'ama', params: { handle: 'kwesi' } })

// ---- projects ----
const agent = await agentFor('ama')
const pub = await call(projectsPost, { user: 'ama', body: { agentId: agent.id, name: 'shop-assistant', tags: ['retail'], readme: '# Shop assistant', note: 'First release' } })
assert(pub.status === 200 && pub.body.created && pub.body.project.owner === 'ama' && !('payload' in pub.body.project), 'publishing a project returns its card')
assert((await call(projectsPost, { user: 'kwesi', body: { agentId: agent.id, name: 'stolen' } })).status === 404, 'you cannot publish someone else\'s agent')
const leaky = await agentFor('ama', { name: 'Leaky', instructions: `Use sk-${'a1B2c3D4'.repeat(4)} always.` })
const blocked = await call(projectsPost, { user: 'ama', body: { agentId: leaky.id, name: 'leaky' } })
assert(blocked.status === 422 && blocked.body.data.scan.verdict === 'blocked', 'a project with a key is a 422 carrying the findings')
const detail = await call(projectGet, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })
assert(detail.body.author.name === 'Name ama' && detail.body.versions.length === 1 && detail.body.files.length >= 3 && detail.body.starred === false && detail.body.isOwner === false && !('userId' in detail.body), 'a project page has the maker, versions, files and the viewer\'s own flags')
assert((await call(projectGet, { params: { owner: 'ama', name: 'nope' } })).status === 404, 'a missing project is a 404')
assert((await call(projectsGet, { query: { q: 'shop' } })).body.items.length === 1 && (await call(projectsGet, { query: { sort: 'bad' } })).status === 400, 'projects are listed and searched; a bad sort is a 400')
assert((await call(personProjects, { params: { handle: 'ama' } })).body.items.length === 1, 'a person\'s projects are listed')
assert((await call(starPost, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })).body.stars === 1 && (await call(starDelete, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })).body.stars === 0, 'star and unstar')
await call(starPost, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })
// (The install route reads the skill list through Vite, so it cannot load here; installing is covered in reefCommunity.test.mts.)
const frk = await call(forkPost, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' }, body: {} })
assert(frk.status === 200 && frk.body.owner === 'kwesi' && frk.body.forkedFrom.owner === 'ama', 'forking works')
assert((await call(forksGet, { params: { owner: 'ama', name: 'shop-assistant' } })).body.items.length === 1, 'the original lists its forks')

// ---- posts ----
const p1 = await call(postsPost, { user: 'ama', body: { text: 'Shipped v1 of shop-assistant.', projectId: 'ama__shop-assistant' } })
assert(p1.status === 200 && p1.body.author.handle === 'ama' && p1.body.project.name === 'shop-assistant' && !('userId' in p1.body), 'a post comes back with its author and project')
assert((await call(postsPost, { user: 'ama', body: { text: `key sk-${'a1B2c3D4'.repeat(4)}` } })).status === 422 && (await call(postsPost, { user: 'ama', body: { text: '' } })).status === 400, 'a post with a key is a 422, an empty post a 400')
await call(postsPost, { user: 'kwesi', body: { text: 'Second post' } })
const feed = await call(feedGet, { user: 'ama' })
assert(feed.body.items.length === 2 && feed.body.items[0].text === 'Second post' && feed.body.items[1].liked === false, 'the feed is newest first')
assert((await call(feedGet, { user: 'ama', query: { tab: 'following' } })).body.items.map((p: any) => p.text).join() === 'Second post', 'the Following tab shows people you follow')
assert((await call(feedGet, { query: { tab: 'following' } })).body.items.length === 0, 'signed out, Following is empty')
assert((await call(likePost, { user: 'kwesi', params: { id: p1.body.id } })).body.likes === 1 && (await call(feedGet, { user: 'kwesi' })).body.items.find((p: any) => p.id === p1.body.id).liked === true, 'liking shows to the liker')
assert((await call(likeDelete, { user: 'kwesi', params: { id: p1.body.id } })).body.likes === 0, 'unliking')
const rep = await call(replyPost, { user: 'kwesi', params: { id: p1.body.id }, body: { text: 'Nice work' } })
const thread = await call(postGet, { params: { id: p1.body.id } })
assert(rep.body.type === 'reply' && thread.body.post.replies === 1 && thread.body.replies[0].text === 'Nice work', 'a reply shows under its post')
assert((await call(postDelete, { user: 'efua', params: { id: p1.body.id } })).status === 404 && (await call(postDelete, { user: 'kwesi', params: { id: rep.body.id } })).body.success, 'you can delete your own reply, not other people\'s posts')

// ---- questions ----
const q = await call(questionsPost, { user: 'efua', body: { title: 'How do I connect Paystack to a workflow?', text: 'I have the Sheet side.', tags: ['paystack'] } })
assert(q.status === 200 && q.body.type === 'question' && q.body.title.startsWith('How do I'), 'a question is posted')
const ans = await call(replyPost, { user: 'ama', params: { id: q.body.id }, body: { text: 'Use the webhook trigger.' } })
assert(ans.body.type === 'answer', 'a reply to a question is an answer')
assert((await call(acceptPost, { user: 'ama', params: { id: ans.body.id } })).status === 403 && (await call(acceptPost, { user: 'efua', params: { id: ans.body.id } })).body.accepted === ans.body.id, 'only the asker marks the answer that worked')
const qthread = await call(postGet, { params: { id: q.body.id } })
assert(qthread.body.post.accepted === ans.body.id && qthread.body.replies[0].isAccepted === true, 'the page knows which answer worked')
assert((await call(questionsGet, { query: { filter: 'solved' } })).body.items.length === 1 && (await call(questionsGet, { query: { filter: 'unanswered' } })).body.items.length === 0, 'solved and unanswered filters')
const asked = await call(questionsPost, { user: 'efua', body: { title: 'Which skill should I install first?', projectId: 'ama__shop-assistant' } })
assert((await call(projectQuestions, { params: { owner: 'ama', name: 'shop-assistant' } })).body.items.map((x: any) => x.id).join() === asked.body.id, 'a project lists the questions asked about it')
assert((await call(personPosts, { params: { handle: 'efua' }, query: { kind: 'questions' } })).body.items.length === 2, 'a person\'s questions are listed')

// ---- side, search, alerts ----
const side = (await call(sideGet, { user: 'ama' })).body
assert(side.trending.length >= 1 && side.people.every((p: any) => p.handle !== 'ama' && p.handle !== 'kwesi') && side.open.length >= 1, 'the side column has popular projects, people to follow (not you or ones you follow) and open questions')
const found = (await call(searchGet, { query: { q: 'ama' } })).body
assert(found.people.map((p: any) => p.handle).join() === 'ama' && found.projects.length === 1 && (await call(searchGet, { query: { q: '  ' } })).body.projects.length === 0, 'search finds projects and people')
const myAlerts = (await call(alertsGet, { user: 'ama' })).body.items
assert(myAlerts.some((a: any) => a.type === 'reply') && myAlerts.some((a: any) => a.type === 'star') && myAlerts.some((a: any) => a.type === 'fork') && myAlerts.some((a: any) => a.type === 'like'), 'alerts list replies, stars, forks and likes')
assert((await call(meGet, { user: 'ama' })).body.unread > 0 && (await call(alertsRead, { user: 'ama', body: {} })).status === 200 && (await call(meGet, { user: 'ama' })).body.unread === 0, 'unread alerts count and clear')

// ---- reports and the queue ----
assert((await call(postReport, { user: 'ama', params: { id: p1.body.id }, body: { reason: 'spam' } })).status === 409, 'reporting your own post is refused')
for (const u of ['kwesi', 'efua', 'richie']) await call(projectReport, { user: u, params: { owner: 'ama', name: 'shop-assistant' }, body: { reason: 'spam', note: 'ad' } })
assert((await call(projectGet, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })).status === 404, 'three reports hide a project from others')
const queue = await call(queueGet, { user: 'richie' })
assert(queue.body.items.length === 1 && queue.body.items[0].targetId === 'ama/shop-assistant' && queue.body.items[0].reports === 3, 'the admin sees it in the queue')
assert((await call(queuePost, { user: 'richie', body: { targetType: 'project', targetId: 'ama/shop-assistant', action: 'restore' } })).status === 200 && (await call(projectGet, { user: 'kwesi', params: { owner: 'ama', name: 'shop-assistant' } })).status === 200, 'restoring puts it back')
assert((await call(projectDelete, { user: 'efua', params: { owner: 'ama', name: 'shop-assistant' } })).status === 403 && (await call(projectDelete, { user: 'ama', params: { owner: 'ama', name: 'shop-assistant' } })).body.success, 'only the maker deletes a project')

console.log(process.exitCode ? 'Reef route tests FAILED' : 'Reef route tests OK')
