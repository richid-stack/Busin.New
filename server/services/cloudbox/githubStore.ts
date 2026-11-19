import { open, seal } from '../../utils/secretBox'
import { checkConnection, installRunner } from './github'
import type { Connection, GithubDeps } from './github'
import { RUNNER_REPO } from './githubWorkflow'
import { RUNNER_SCRIPT_VERSION } from './githubRunnerScript.generated'

const LINKS = 'github_runner'
const SETTINGS = 'user_settings'
const PURPOSE = 'github-runner'

/** Where a "run in the cloud" plan goes. */
export type CloudWhere = 'github' | 'box'

export interface LastRun { at: string, seconds: number, minutes: number, ok: boolean }

/** One person's link to their own GitHub. The token is sealed with the server key and never leaves the server. */
export interface GithubLink {
  userId: string
  sealedToken: string
  login: string
  repo: string
  defaultBranch: string
  runnerVersion: string
  connectedAt: string
  checkedAt: string
  lastRun: LastRun | null
}

/** What the browser may see. No token, not even a part of one. */
export interface GithubStatus {
  connected: boolean
  login?: string
  repo?: string
  checkedAt?: string
  lastRun?: LastRun | null
}

export const viewLink = (link: GithubLink | null): GithubStatus => link
  ? { connected: true, login: link.login, repo: link.repo, checkedAt: link.checkedAt, lastRun: link.lastRun }
  : { connected: false }

export async function getLink(db: any, userId: string): Promise<GithubLink | null> {
  const doc = await db.collection(LINKS).doc(userId).get()
  return doc.exists ? doc.data() as GithubLink : null
}

/** The token for a link. Throws SecretBoxError when the server key has changed since it was stored. */
export const tokenOf = (link: GithubLink): string => open(link.sealedToken, PURPOSE)

/**
 * Checks the token, puts the runner into the repo, and only then stores the token (sealed).
 * A token that fails a check is never stored. The first connection also makes GitHub the place plans go.
 */
export async function connectGithub(db: any, userId: string, token: string, deps: GithubDeps = {}): Promise<GithubStatus> {
  const clean = token.trim()
  const conn = await checkConnection(clean, deps)
  await installRunner(clean, conn, deps)
  const now = new Date().toISOString()
  const before = await getLink(db, userId)
  const link: GithubLink = {
    userId, sealedToken: seal(clean, PURPOSE), login: conn.login, repo: conn.repo, defaultBranch: conn.defaultBranch,
    runnerVersion: RUNNER_SCRIPT_VERSION, connectedAt: before?.connectedAt ?? now, checkedAt: now, lastRun: before?.lastRun ?? null
  }
  await db.collection(LINKS).doc(userId).set(link)
  if (!before) await setCloudWhere(db, userId, 'github')
  return viewLink(link)
}

/** Checks the stored token again and brings the runner up to date. A failed check keeps the link but says why. */
export async function recheckGithub(db: any, userId: string, deps: GithubDeps = {}): Promise<GithubStatus> {
  const link = await getLink(db, userId)
  if (!link) return viewLink(null)
  const token = tokenOf(link)
  const conn: Connection = await checkConnection(token, deps)
  await installRunner(token, conn, deps)
  const next: GithubLink = { ...link, login: conn.login, repo: conn.repo, defaultBranch: conn.defaultBranch, runnerVersion: RUNNER_SCRIPT_VERSION, checkedAt: new Date().toISOString() }
  await db.collection(LINKS).doc(userId).set(next)
  return viewLink(next)
}

export async function recordRun(db: any, userId: string, run: LastRun): Promise<void> {
  try {
    const link = await getLink(db, userId)
    if (link) await db.collection(LINKS).doc(userId).set({ ...link, lastRun: run })
  } catch { /* a note about the last run must never fail a run */ }
}

/** Forgets the token and, if GitHub was the chosen place, goes back to the default. The repo and its files stay in their GitHub. */
export async function disconnectGithub(db: any, userId: string): Promise<void> {
  await db.collection(LINKS).doc(userId).delete()
  if ((await getCloudWhere(db, userId)) === 'github') await setCloudWhere(db, userId, null)
}

export async function getCloudWhere(db: any, userId: string): Promise<CloudWhere | null> {
  try {
    const doc = await db.collection(SETTINGS).doc(userId).get()
    const v = doc.exists ? doc.data()?.cloudWhere : null
    return v === 'github' || v === 'box' ? v : null
  } catch { return null }
}

export async function setCloudWhere(db: any, userId: string, where: CloudWhere | null): Promise<void> {
  const ref = db.collection(SETTINGS).doc(userId)
  // The other settings in the same record (powers, email switches, the browser) are left as they are.
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    const data = doc.exists ? { ...doc.data() } : {}
    if (where) data.cloudWhere = where; else delete data.cloudWhere
    tx.set(ref, { ...data, userId, updatedAt: new Date().toISOString() })
  })
}

/**
 * Which place the assistant is offered for "run in the cloud". The person's choice wins when it can work; otherwise GitHub
 * when it is connected (it costs OpenLobs nothing), otherwise the OpenLobs box when this app has one, otherwise nothing.
 */
export function chooseCloud(opts: { where: CloudWhere | null, linked: boolean, box: boolean }): CloudWhere | null {
  if (opts.where === 'box' && opts.box) return 'box'
  if (opts.where === 'github' && opts.linked) return 'github'
  if (opts.linked) return 'github'
  return opts.box ? 'box' : null
}

export { RUNNER_REPO }
