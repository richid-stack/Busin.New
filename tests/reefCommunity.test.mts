import { createFakeFirestore } from './fakeFirestore'
import { markDeleting } from '../server/services/account/tombstone'
import type { Agent } from '../server/services/agents/profile'
import { createReef } from '../server/services/reef/reef'
import { ReefError } from '../server/services/reef/model'
import { isReefAdmin } from '../server/services/reef/moderation'
import { fileRows, filesOf, madeOf } from '../server/services/reef/projects'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (fn: () => Promise<unknown>, code?: string) => { try { await fn() } catch (e) { return e instanceof ReefError ? (code ? e.code === code : true) : false } return false }
const failMessage = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return (e as Error).message } return '' }

// Every call to "now" is one minute later, so ordering is deterministic.
let tick = 0
const clock = () => new Date(Date.UTC(2026, 9, 26, 8, 0, 0) + (++tick) * 60_000)
const db = createFakeFirestore()
const reef = createReef(db as any, { now: clock })
const { profiles, projects, posts, alerts, moderation } = reef

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'a1', userId: 'u-ama', name: 'Shop assistant', description: 'Answers customers.', instructions: 'Answer customer messages. Ask before any refund.',
  model: 'my:groq/openai/gpt-oss-120b', tools: ['web', 'create_files', 'apps'], skills: ['ghana-invoice', 'not-on-this-server'], maxSteps: 8,
  createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z', ...over
})

// ---- Profiles ----
const ama = await profiles.create('u-ama', { handle: '@Ama', name: 'Ama Boateng', bio: 'Runs a small shop.', place: 'Accra' })
assert(ama.handle === 'ama' && !ama.verified && !ama.official && ama.followers === 0, 'a profile is made with a lowercase handle and no badges')
assert(await fails(() => profiles.create('u-ama', { handle: 'ama2', name: 'Again' }), 'conflict'), 'a person has one profile')
assert(await fails(() => profiles.create('u-kwesi', { handle: 'ama', name: 'Kwesi' }), 'taken'), 'a taken handle is refused')
for (const bad of ['ab', '1abc', 'has space', 'a'.repeat(21), 'with-dash']) assert(await fails(() => profiles.create('u-x', { handle: bad, name: 'X' })), `handle "${bad}" is refused`)
for (const kept of ['openlobs', 'admin', 'projects', 'api']) assert(await fails(() => profiles.create('u-x', { handle: kept, name: 'X' }), 'taken'), `the kept handle "${kept}" is refused`)
const race = await Promise.allSettled([profiles.create('u-r1', { handle: 'racer', name: 'R1' }), profiles.create('u-r2', { handle: 'racer', name: 'R2' })])
assert(race.filter(r => r.status === 'fulfilled').length === 1, 'two people claiming one handle at once: exactly one gets it')
assert(await fails(() => profiles.create('u-y', { handle: 'yaw_o', name: 'Yaw', bio: 'hello​there' }), 'blocked'), 'a bio with invisible characters is refused')
assert(await fails(() => profiles.create('u-y', { handle: 'yaw_o', name: 'Yaw', bio: 'x'.repeat(161) })), 'a bio over 160 characters is refused')
await profiles.create('u-kwesi', { handle: 'kwesi', name: 'Kwesi Mensah' })
const efua = await profiles.create('u-efua', { handle: 'efua', name: 'Efua Tetteh' })
await profiles.update('u-ama', { bio: 'New bio' })
assert((await profiles.getByHandle('AMA'))?.bio === 'New bio' && (await profiles.getByHandle('ama'))?.handle === 'ama', 'a profile can be changed and the handle stays')
assert((await profiles.getByHandle('nobody')) === null && (await profiles.getByHandle('!!')) === null, 'an unknown handle finds no one')
const badged = await profiles.setBadges('kwesi', { verified: true })
assert(badged.verified && (await profiles.get('u-kwesi'))!.verified && !(await profiles.get('u-kwesi'))!.official, 'a badge is handed out by hand')
const official = await profiles.createReserved('u-team', { handle: 'openlobs', name: 'OpenLobs' })
assert(official.official && official.verified, 'the team account can claim a kept handle')
assert(!('userId' in (await import('../server/services/reef/profiles')).publicProfile(ama)), 'the public view has no account id')

// ---- Follows ----
assert(await fails(() => profiles.follow('u-ama', 'ama'), 'invalid'), 'you cannot follow yourself')
assert(await fails(() => profiles.follow('u-nobody', 'kwesi'), 'no_profile'), 'following needs a profile')
const f1 = await profiles.follow('u-ama', 'kwesi')
const f2 = await profiles.follow('u-ama', 'kwesi')
assert(f1.followers === 1 && f2.followers === 1 && (await profiles.get('u-ama'))!.following === 1, 'following twice counts once')
await profiles.follow('u-efua', 'kwesi')
assert((await profiles.get('u-kwesi'))!.followers === 2, 'followers add up')
assert((await profiles.followingIds('u-ama')).join() === 'u-kwesi', 'the people you follow are listed')
assert((await alerts.list('u-kwesi')).filter(a => a.type === 'follow').length === 2, 'the person followed gets an alert, once per follower')
const un = await profiles.unfollow('u-ama', 'kwesi')
const un2 = await profiles.unfollow('u-ama', 'kwesi')
assert(un.followers === 1 && un2.followers === 1 && (await profiles.get('u-ama'))!.following === 0, 'unfollowing twice counts once and never goes below zero')
const sugg = await profiles.suggestions('u-ama', 3)
assert(!sugg.some(p => p.userId === 'u-ama' || p.official) && sugg[0]!.handle === 'kwesi', 'suggestions leave out you and the team account, most followed first')
assert((await profiles.searchHandles('kw')).map(p => p.handle).join() === 'kwesi' && (await profiles.searchHandles('')).length === 0, 'people are found by the start of a handle')

// ---- Projects ----
assert(await fails(() => projects.publish('u-nobody', agent(), { name: 'x-one' }), 'no_profile'), 'publishing needs a profile')
assert(await fails(() => projects.publish('u-ama', agent(), { name: 'Bad Name!' })), 'a project name has rules')
assert(await fails(() => projects.publish('u-ama', agent(), { name: '-dash' })) && await fails(() => projects.publish('u-ama', agent(), { name: 'x'.repeat(41) })), 'no leading dash, at most 40 characters')
const secretKey = `sk-${'a1B2c3D4'.repeat(4)}`
const blocked = await failMessage(() => projects.publish('u-ama', agent({ instructions: `Use ${secretKey} to call it.` }), { name: 'leaky' }))
assert(blocked.includes('cannot be shared') && !blocked.includes(secretKey), 'a pasted key stops publishing')
assert(await fails(() => projects.publish('u-ama', agent(), { name: 'leaky', readme: `my key ${secretKey}` }), 'blocked'), 'a key in the README stops it too')
const p1 = await projects.publish('u-ama', agent(), { name: 'shop-assistant', tags: ['Retail', 'mobile money', 'retail', 'ghana', 'a', 'b', 'c'], readme: '# Shop assistant\nAnswers customers.', note: 'First release' })
assert(p1.created && p1.project.version === 1 && p1.project.owner === 'ama' && p1.project.licence === 'cc-by-4.0', 'a new project starts at version 1 with the default licence')
assert(p1.project.tags.join() === 'retail,mobile-money,ghana,a,b', 'tags are tidied, de-duplicated and capped at five')
assert(!JSON.stringify(p1.project.payload).includes('groq') && !('model' in p1.project.payload), 'the model is never shared')
assert((await profiles.get('u-ama'))!.projects === 1, 'the maker\'s project count goes up')
const files1 = fileRows(p1.project.files)
assert(files1.map(f => f.name).join() === 'skills,agent.json,instructions.md,README.md' && files1[0]!.kind === 'dir', 'the file table lists skills, settings, instructions and the README')
const v2 = await projects.publish('u-ama', agent({ instructions: 'Answer customer messages. Ask before any refund. Remind on mobile money.' }), { name: 'shop-assistant', readme: '# Shop assistant\nAnswers customers.', note: 'Remind on mobile money' })
assert(!v2.created && v2.project.version === 2 && (await profiles.get('u-ama'))!.projects === 1, 'publishing under the same name is a new version, not a new project')
const files2 = Object.fromEntries(fileRows(v2.project.files).map(f => [f.name, f]))
assert(files2['instructions.md']!.note === 'Remind on mobile money' && files2['README.md']!.note === 'First release' && files2['agent.json']!.note === 'First release', 'each file keeps the note of the version that last changed it')
const d1 = await projects.detail('ama', 'shop-assistant', 'u-kwesi')
assert(d1.versions.map(v => v.version).join() === '2,1' && d1.versions[0]!.note === 'Remind on mobile money', 'the version history is newest first')
assert(d1.made.reduce((n, m) => n + m.pct, 0) === 100 && d1.made.length === 3, 'the "made of" bar adds up to 100')
assert(!('userId' in d1) && !('payload' in d1) && d1.instructions.includes('mobile money') && d1.isOwner === false && d1.starred === false, 'the detail has no account id and says whether you own or starred it')
assert(d1.works.some(w => w.id === 'apps' && w.sensitive) && d1.safety === 'passed', 'it lists what the project needs and its safety result')
assert((await projects.detail('ama', 'shop-assistant', 'u-ama')).isOwner, 'the owner is told it is theirs')
assert(await fails(() => projects.detail('ama', 'nope'), 'not_found'), 'a missing project is not found')
assert(madeOf({}).length === 0 && filesOf({ readme: '', payload: p1.project.payload })['README.md'] === undefined, 'an empty README is not a file')
const kp = await projects.publish('u-kwesi', agent({ id: 'a2', userId: 'u-kwesi', name: 'Weekly digest', description: 'Digest.', instructions: 'Write a weekly digest per client.', tools: ['web'], skills: [] }), { name: 'weekly-digest', licence: 'mit', tags: ['agency'] })
const lock = await projects.publish('u-efua', agent({ id: 'a3', userId: 'u-efua', instructions: 'Draft fee reminders.', tools: ['web'], skills: [] }), { name: 'fees', licence: 'all-rights-reserved' })

// ---- Listing ----
assert((await projects.list({ sort: 'new' })).map(p => p.name).join() === 'fees,weekly-digest,shop-assistant', 'newest first is by last change')
assert((await projects.list({ q: 'digest' })).map(p => p.name).join() === 'weekly-digest' && (await projects.list({ tag: 'Agency' })).length === 1 && (await projects.list({ q: 'zzz' })).length === 0, 'search looks at names, descriptions and tags')
assert((await projects.listByOwner('ama')).length === 1 && (await projects.listByOwner('nobody')).length === 0, 'one person\'s projects are listed')
assert(!('payload' in (await projects.list())[0]!) && !('readme' in (await projects.list())[0]!), 'lists carry cards, not whole projects')

// ---- Stars ----
assert(await fails(() => projects.star('u-nobody', 'ama', 'shop-assistant'), 'no_profile'), 'starring needs a profile')
const s1 = await projects.star('u-kwesi', 'ama', 'shop-assistant')
const s2 = await projects.star('u-kwesi', 'ama', 'shop-assistant')
await projects.star('u-efua', 'ama', 'shop-assistant')
assert(s1.stars === 1 && s2.stars === 1 && (await projects.load('ama__shop-assistant'))!.stars === 2, 'starring twice counts once')
assert((await profiles.get('u-ama'))!.starsEarned === 2 && (await alerts.list('u-ama')).filter(a => a.type === 'star').length === 2, 'the maker earns the stars and is told')
assert((await projects.detail('ama', 'shop-assistant', 'u-kwesi')).starred, 'the viewer sees they starred it')
assert((await projects.listStarred('u-kwesi')).map(p => p.name).join() === 'shop-assistant', 'a person\'s stars are listed')
const u1 = await projects.unstar('u-kwesi', 'ama', 'shop-assistant')
await projects.unstar('u-kwesi', 'ama', 'shop-assistant')
assert(u1.stars === 1 && (await profiles.get('u-ama'))!.starsEarned === 1, 'unstarring twice takes one star off')
await projects.star('u-ama', 'weekly-digest'.split('-')[0] === 'weekly' ? 'kwesi' : 'kwesi', 'weekly-digest')
const trend = await projects.trending(2)
assert(trend.length === 2 && trend.map(t => t.name).sort().join() === 'shop-assistant,weekly-digest', 'trending uses the stars of the last week')

// ---- Install ----
const installed: any[] = []
const deps = { skills: new Set(['ghana-invoice']), agentCount: async () => 0, maxAgents: 10, createAgent: async (userId: string, input: any, source: any) => { installed.push({ userId, input, source }); return { ...agent(), ...input, id: 'new', userId } as Agent } }
const inst = await projects.install('u-efua', 'ama', 'shop-assistant', [], deps)
assert(!installed[0].input.tools.includes('apps') && inst.withheld.some(n => n.id === 'apps') && installed[0].input.skills.join() === 'ghana-invoice' && inst.droppedSkills.join() === 'not-on-this-server', 'installing withholds apps until ticked and drops unknown skills')
assert(installed[0].source.project === 'ama/shop-assistant' && installed[0].source.version === 2 && installed[0].source.author === 'Ama Boateng', 'the copy remembers where it came from')
assert((await projects.load('ama__shop-assistant'))!.installs === 1, 'installs are counted')
const inst2 = await projects.install('u-efua', 'ama', 'shop-assistant', ['apps'], deps)
assert(inst2.withheld.length === 0 && installed[1].input.tools.includes('apps'), 'ticking a group turns it on')
assert(await fails(() => projects.install('u-efua', 'ama', 'shop-assistant', [], { ...deps, agentCount: async () => 10 }), 'limit'), 'the agent limit holds')

// ---- Forks ----
assert(await fails(() => projects.fork('u-ama', 'ama', 'shop-assistant'), 'conflict'), 'you cannot fork your own project')
assert(await fails(() => projects.fork('u-kwesi', 'efua', 'fees'), 'forbidden'), 'all rights reserved cannot be forked')
const fk = await projects.fork('u-kwesi', 'ama', 'shop-assistant')
assert(fk.owner === 'kwesi' && fk.forkedFrom?.owner === 'ama' && fk.version === 1 && fk.stars === 0 && fk.readme.includes('Answers customers'), 'a fork is a copy under your handle that remembers its source')
assert((await projects.load('ama__shop-assistant'))!.forks === 1 && (await profiles.get('u-kwesi'))!.projects === 2, 'the original counts the fork')
assert((await alerts.list('u-ama')).some(a => a.type === 'fork'), 'the original maker is told')
assert((await projects.listForks('ama', 'shop-assistant')).map(p => `${p.owner}/${p.name}`).join() === 'kwesi/shop-assistant', 'forks are listed on the original')
assert(await fails(() => projects.fork('u-efua', 'ama', 'shop-assistant', 'shop-assistant').then(() => projects.fork('u-efua', 'ama', 'shop-assistant')), 'conflict'), 'a fork name already used is refused')

// ---- Posts ----
assert(await fails(() => posts.create('u-nobody', { text: 'hi' }), 'no_profile'), 'posting needs a profile')
assert(await fails(() => posts.create('u-ama', { text: '   ' })) && await fails(() => posts.create('u-ama', { text: 'x'.repeat(501) })), 'a post is 1 to 500 characters')
assert(await fails(() => posts.create('u-ama', { text: `my key ${secretKey}` }), 'blocked'), 'a post with a key is refused')
assert(await fails(() => posts.create('u-ama', { text: 'x', projectId: 'ama__nope' }), 'not_found'), 'a post can only show a project that exists')
const post1 = await posts.create('u-ama', { text: 'Shipped v2 of shop-assistant.', projectId: 'ama__shop-assistant' })
const flaggedPost = await posts.create('u-kwesi', { text: 'Use the form at https://bit.ly/abc please' })
const post3 = await posts.create('u-efua', { text: 'Our fees reminders run on Fridays now.' })
assert(post1.feed && !post1.flagged && flaggedPost.flagged, 'a post is in the feed; one with a shortened link is flagged for review')
const feed = await posts.feed({ tab: 'foryou' })
assert(feed.map(p => p.id).join() === [post3.id, flaggedPost.id, post1.id].join(), 'the feed is newest first')
assert((await posts.feed({ tab: 'foryou', before: post3.createdAt })).map(p => p.id).join() === [flaggedPost.id, post1.id].join() && (await posts.feed({ tab: 'foryou', limit: 1 })).length === 1, 'the feed pages with a cursor and a limit')
await profiles.follow('u-ama', 'kwesi')
assert((await posts.feed({ tab: 'following', viewerId: 'u-ama' })).map(p => p.id).join() === flaggedPost.id && (await posts.feed({ tab: 'following', viewerId: 'u-lonely' })).length === 0 && (await posts.feed({ tab: 'following' })).length === 0, 'Following shows only the people you follow')
const views = await reef.postViews(await posts.feed({ tab: 'foryou' }), 'u-ama')
const mine = views.find(v => v.id === post1.id)!
assert(mine.author.name === 'Ama Boateng' && mine.mine && mine.project?.name === 'shop-assistant' && !('userId' in mine), 'a post is shown with its author and its project')
assert(views.find(v => v.id === flaggedPost.id)!.author.verified === true, 'the verified badge shows next to the name')

// likes
const l1 = await posts.like('u-kwesi', post1.id)
const l2 = await posts.like('u-kwesi', post1.id)
assert(l1.likes === 1 && l2.likes === 1 && (await posts.like('u-efua', post1.id)).likes === 2, 'liking twice counts once')
assert((await reef.postViews([await posts.get(post1.id)], 'u-kwesi'))[0]!.liked && !(await reef.postViews([await posts.get(post1.id)], 'u-ama'))[0]!.liked, 'the viewer sees whether they liked it')
assert((await alerts.list('u-ama')).filter(a => a.type === 'like').length === 2, 'the author is told about likes')
assert((await posts.unlike('u-kwesi', post1.id)).likes === 1 && (await posts.unlike('u-kwesi', post1.id)).likes === 1, 'unliking twice takes one off')

// replies, questions, answers
const rep = await posts.reply('u-kwesi', post1.id, { text: 'Nice work' })
assert(rep.type === 'reply' && !rep.feed && (await posts.load(post1.id))!.replies === 1, 'a reply sits under the post and is counted')
assert(await fails(() => posts.reply('u-ama', rep.id, { text: 'nested' })), 'replies stay one level under the post')
assert(await fails(() => posts.reply('u-ama', 'nope', { text: 'x' }), 'not_found') && await fails(() => posts.reply('u-ama', post1.id, { text: '' })), 'a reply needs a post and some words')
assert((await alerts.list('u-ama')).some(a => a.type === 'reply'), 'the author is told about a reply')
assert(await fails(() => posts.ask('u-ama', { title: 'short' })), 'a question needs a real headline')
const q = await posts.ask('u-ama', { title: 'How do I connect Paystack to a workflow?', text: 'I have the Sheet side.', tags: ['Paystack', 'webhooks'], projectId: 'ama__shop-assistant' })
assert(q.type === 'question' && q.feed && q.qlist && q.tags.join() === 'paystack,webhooks', 'a question is in the feed and the questions list')
const a1 = await posts.reply('u-kwesi', q.id, { text: 'Use the webhook trigger.' })
const a2 = await posts.reply('u-efua', q.id, { text: 'Or poll the API.' })
assert(a1.type === 'answer' && (await posts.load(q.id))!.replies === 2 && (await alerts.list('u-ama')).some(a => a.type === 'answer'), 'an answer is counted and the asker is told')
assert(await fails(() => posts.accept('u-kwesi', a1.id), 'forbidden') && await fails(() => posts.accept('u-ama', rep.id), 'not_found'), 'only the asker can mark an answer, and only an answer')
await posts.accept('u-ama', a2.id)
assert((await posts.replies(q.id)).map(p => p.id).join() === `${a2.id},${a1.id}` && (await alerts.list('u-efua')).some(a => a.type === 'accepted'), 'the marked answer comes first and its writer is told')
const qv = await reef.postViews(await posts.replies(q.id), 'u-ama', await posts.load(q.id))
assert(qv[0]!.isAccepted && !qv[1]!.isAccepted, 'the page can tell which answer worked')
await posts.accept('u-ama', a1.id)
assert((await posts.load(q.id))!.accepted === a1.id, 'choosing another answer moves the mark')
const q2 = await posts.ask('u-efua', { title: 'Can a workflow wait for my approval?' })
assert((await posts.questions({ filter: 'new' })).map(p => p.id).join() === `${q2.id},${q.id}`, 'questions list newest first')
assert((await posts.questions({ filter: 'unanswered' })).map(p => p.id).join() === q2.id && (await posts.questions({ filter: 'solved' })).map(p => p.id).join() === q.id, 'questions filter to unanswered and solved')
assert((await posts.openQuestions(3)).map(p => p.id).join() === q2.id, 'open questions leave out solved ones')
assert((await posts.questionsAbout('ama__shop-assistant')).map(p => p.id).join() === q.id && (await posts.byUser('u-ama', { kind: 'questions' })).map(p => p.id).join() === q.id, 'questions are found by project and by person')
assert((await posts.feed({ tab: 'questions' })).every(p => p.type === 'question'), 'the Questions tab of the feed has only questions')

// removing
await posts.remove('u-kwesi', rep.id)
assert((await posts.load(post1.id))!.replies === 0 && await fails(() => posts.remove('u-kwesi', post1.id), 'not_found'), 'you can delete your reply but not someone else\'s post')
await posts.remove('u-ama', q.id)
assert(!(await posts.load(q.id)) && !(await posts.load(a1.id)) && !(await posts.load(a2.id)), 'deleting a question deletes its answers')

// ---- Reports and the review queue ----
assert(await fails(() => moderation.report('u-ama', 'post', post1.id, 'spam', ''), 'conflict'), 'you cannot report your own post')
await moderation.report('u-kwesi', 'post', post3.id, 'spam', 'ad')
await moderation.report('u-kwesi', 'post', post3.id, 'spam', 'again')
assert((await posts.load(post3.id))!.hidden === false, 'one person reporting twice is one report')
await moderation.report('u-ama', 'post', post3.id, 'harmful', '')
const third = await moderation.report('u-mod', 'post', post3.id, 'spam', '')
assert(third.hidden && (await posts.load(post3.id))!.hidden && !(await posts.feed({ tab: 'foryou' })).some(p => p.id === post3.id), 'three different people hide it from the feed')
assert(await fails(() => posts.get(post3.id), 'not_found') && (await posts.get(post3.id, 'u-efua')).id === post3.id, 'a hidden post is gone for others and still visible to its author')
const queue = await moderation.queue()
assert(queue.length === 1 && queue[0]!.targetId === post3.id && queue[0]!.reports === 3 && queue[0]!.hidden && queue[0]!.reasons.includes('harmful'), 'the queue lists it with the number of reports')
await moderation.resolve('post', post3.id, 'restore')
assert(!(await posts.load(post3.id))!.hidden && (await posts.feed({ tab: 'foryou' })).some(p => p.id === post3.id) && (await moderation.queue()).length === 0, 'restoring puts it back and clears the queue')
for (const who of ['u-kwesi', 'u-efua', 'u-mod']) await moderation.report(who, 'project', 'ama/shop-assistant', 'spam', '')
assert((await projects.load('ama__shop-assistant'))!.hidden && !(await projects.list()).some(p => p.owner === 'ama') && await fails(() => projects.detail('ama', 'shop-assistant', 'u-kwesi'), 'not_found') && (await projects.detail('ama', 'shop-assistant', 'u-ama')).name === 'shop-assistant', 'a project reported by three people disappears from lists and stays visible to its maker')
await moderation.resolve('project', 'ama/shop-assistant', 'restore')
assert(!(await projects.load('ama__shop-assistant'))!.hidden, 'and can be restored')
assert(isReefAdmin({ id: 'x', email: 'Richie@Example.com' }, 'richie@example.com, other') && isReefAdmin({ id: 'U-1' }, 'u-1') && !isReefAdmin({ id: 'x', email: 'a@b.c' }, 'richie@example.com') && !isReefAdmin({ id: 'x' }, undefined) && !isReefAdmin(null, 'x'), 'only people listed in REEF_ADMINS run the queue')

// ---- Removing a project and deleting an account ----
await projects.remove('u-kwesi', 'kwesi', 'shop-assistant')
assert(!(await projects.load('kwesi__shop-assistant')) && (await profiles.get('u-kwesi'))!.projects === 1, 'removing a project lowers the maker\'s count')
assert(await fails(() => projects.remove('u-efua', 'ama', 'shop-assistant'), 'forbidden'), 'only the maker can remove a project')

await moderation.forgetUser('u-efua')
await posts.forgetUser('u-efua')
await projects.forgetUser('u-efua')
assert(!(await projects.load('efua__fees')) && !(await posts.load(post3.id)) && !(await posts.load(q2.id)), 'deleting an account removes its projects and posts')
const ama2 = await profiles.get('u-ama')
assert((await projects.load('ama__shop-assistant'))!.stars === 0, 'and takes back the stars it gave')

await markDeleting(db, 'u-gone')
await profiles.create('u-gone', { handle: 'gone_one', name: 'Gone' }).then(() => assert(false, 'a person being deleted makes nothing'), () => assert(true, 'a person being deleted makes nothing'))
void kp; void lock; void ama2; void efua
console.log(process.exitCode ? 'Reef community tests FAILED' : 'Reef community tests OK')
