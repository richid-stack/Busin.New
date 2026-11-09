import { reefHandler } from '../../../utils/reefRoute'
import type { Profile } from '../../../services/reef/profiles'
import { authorOf } from '../../../services/reef/profiles'

const authorWithCount = (p: Profile) => ({ ...authorOf(p), followers: p.followers })

/** The right-hand column: popular projects, people to follow, questions waiting for an answer. */
export default reefHandler({ auth: 'optional' }, async ({ user, reef }) => {
  const [trending, people, open] = await Promise.all([reef.projects.trending(3), reef.profiles.suggestions(user?.id ?? null, 3), reef.posts.openQuestions(3)])
  return { trending, people: people.map(authorWithCount), open: (await reef.postViews(open, user?.id)).map(q => ({ id: q.id, title: q.title, replies: q.replies, createdAt: q.createdAt })) }
})
