import { tool } from 'ai'
import { CLOUD_LIMITS, cloudPlanSchema } from '../../../shared/cloudBox'
import { checkStep } from '../../../shared/runPlan'
import { getFirebaseDb } from '../firebaseAdmin'
import { SecretBoxError } from '../secretBox'
import { GithubRunError, githubBox } from '../../services/cloudbox/github'
import type { Connection, GithubBox } from '../../services/cloudbox/github'
import { getLink, recordRun, tokenOf } from '../../services/cloudbox/githubStore'
import { withToolLimits } from './limits'
import { planOutcome } from './runInCloud'
import type { StepOutcome } from './runOnComputer'

const NAME = 'your GitHub'
/** The plan has to fit inside one chat request together with GitHub starting a machine, so it gets a little less than the cloud box. */
const GITHUB_PLAN_MS = 180_000

export interface GithubToolDeps {
  /** Replaced in tests. By default the link and its token come from the database and the box talks to api.github.com. */
  box?: (userId: string) => Promise<GithubBox | null>
  record?: (userId: string, run: { at: string, seconds: number, minutes: number, ok: boolean }) => Promise<void>
}

async function defaultBox(userId: string): Promise<GithubBox | null> {
  const db = getFirebaseDb()
  const link = await getLink(db, userId)
  if (!link) return null
  const conn: Connection = { login: link.login, repo: link.repo, defaultBranch: link.defaultBranch }
  return githubBox(conn, tokenOf(link))
}

/** `error` is what the person reads in the trace. `note` is only for the assistant: how to carry on, and not to pretend anything ran. */
const failed = (error: string, note = 'Nothing was run, so do not pretend the commands ran.') => ({ status: 'failed' as const, computer: NAME, steps: [] as StepOutcome[], error, note })

/**
 * Runs a short plan on the person's own GitHub: a private repo of theirs, on GitHub's machines, using their free
 * minutes. It is the same plan, rulebook and approval card as run_in_cloud and run_on_computer. It costs OpenLobs
 * nothing and uses none of the person's credits, so there is no charge and nothing to refund.
 */
export function createRunOnGithubTool(userId: string, deps: GithubToolDeps = {}) {
  const getBox = deps.box ?? defaultBox
  const record = deps.record ?? ((id: string, run: any) => recordRun(getFirebaseDb(), id, run))
  return tool({
    description: 'Run a short plan of commands on the person\'s own GitHub (a private repo of theirs, on GitHub\'s machines, using their free minutes): install packages, run a script you wrote (put its small text files in "files"), run a public project\'s tests, or check that something works. The machine is empty, has none of the person\'s files or accounts, and is thrown away afterwards. It takes a little longer to start than other places (often 20 to 40 seconds). Use it when the person has no computer connected, or the job should run somewhere clean. If their computer is connected and the job is about their own folder, use run_on_computer instead. The person approves the whole plan once, on a card listing every step and file in plain words. Steps run in order and stop at the first failure. Only the allowed programs and options work (same list as run_on_computer); files must be small plain text. It uses none of their credits.',
    inputSchema: cloudPlanSchema,
    needsApproval: true,
    execute: withToolLimits(
      { name: 'run_on_github', userId, perMinute: 4, timeoutMs: GITHUB_PLAN_MS + 110_000, maxResultChars: 24_000 },
      async (plan, signal) => {
        const words: string[] = []
        for (const [i, s] of plan.steps.entries()) {
          const c = checkStep(s)
          if (!c.ok) return failed(`Step ${i + 1}: ${c.error}`)
          words.push(c.step.words)
        }
        let box: GithubBox | null
        try { box = await getBox(userId) } catch (err) {
          if (err instanceof SecretBoxError) return failed('The saved GitHub token could not be read. Open Settings, then Powers, and connect GitHub again.', 'Tell the person to connect GitHub again in Settings. Do not pretend the commands ran.')
          throw err
        }
        if (!box) return failed('Your GitHub is not set up yet. Open Settings, then Powers, to connect it.', 'Tell the person to open Settings, then Powers, and connect their GitHub. Do not pretend the commands ran.')

        let reply
        try {
          reply = await box.run({ steps: plan.steps, files: plan.files, limitMs: Math.min(CLOUD_LIMITS.planMs, GITHUB_PLAN_MS) }, signal)
        } catch (err: any) {
          if (err instanceof GithubRunError) {
            // A token that stopped working is the one problem the person has to fix themselves, so say where.
            const mine = err.kind === 'token' || err.kind === 'permission' || err.kind === 'repo'
            return failed(
              `${err.message}${mine ? ' Open Settings, then Powers, and press "Check again" or connect GitHub again.' : ''}`,
              `Nothing finished, so do not pretend the commands ran.${mine ? ' Tell the person to open Settings, then Powers, and press "Check again" or connect GitHub again.' : ''}`
            )
          }
          throw err
        }
        if (reply.error && !reply.steps.length) return failed(`${reply.error} Nothing was run.`, 'The plan was refused before anything ran. Do not pretend the commands ran.')

        const outcome = planOutcome(plan, reply, words, NAME, { seconds: reply.seconds, minutes: reply.minutes }, 'The machine has been thrown away')
        await record(userId, { at: new Date().toISOString(), seconds: reply.seconds, minutes: reply.minutes, ok: outcome.status === 'ok' }).catch(() => {})
        return outcome
      }
    )
  })
}
