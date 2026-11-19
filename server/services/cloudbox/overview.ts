import { defaultCloudBox } from './provider'
import { chooseCloud, getCloudWhere, getLink, viewLink } from './githubStore'
import type { CloudWhere, GithubStatus } from './githubStore'

export interface CloudOverview {
  github: GithubStatus
  /** What the person picked, if they did. */
  where: CloudWhere | null
  /** Where plans go right now, after what can work is taken into account. Null means nowhere. */
  chosen: CloudWhere | null
  /** Whether this app has its own cloud box. */
  box: boolean
}

/** Everything the Settings panel needs about "where it runs". Never includes the token. */
export async function cloudOverview(db: any, userId: string, env: NodeJS.ProcessEnv = process.env): Promise<CloudOverview> {
  const [link, where] = await Promise.all([getLink(db, userId), getCloudWhere(db, userId)])
  const box = Boolean(defaultCloudBox(env))
  return { github: viewLink(link), where, chosen: chooseCloud({ where, linked: Boolean(link), box }), box }
}
