import fs from 'node:fs'
import zlib from 'node:zlib'
import { runBoxPlan } from './plan'

/**
 * What runs inside the person's own GitHub repo (openlobs-runs) when OpenLobs sends a plan.
 *
 * It is bundled into one file (npm run build:github-runner) and written into the repo next to the workflow.
 * It uses the very same plan runner as the OpenLobs cloud box (runner/plan.ts), so a plan means the same thing
 * in both places: the rulebook in shared/runPlan.ts is checked again here, every step starts without a shell,
 * and the programs see a short clean list of settings, never the workflow's own token.
 *
 * Input: OPENLOBS_PLAN, the plan packed as gzip then base64. Output: the file named by OPENLOBS_RESULT.
 */
const fail = (message: string) => ({ steps: [] as unknown[], error: message.slice(0, 300) })

async function main() {
  const out = process.env.OPENLOBS_RESULT
  if (!out) throw new Error('OPENLOBS_RESULT is not set.')
  let result: unknown
  try {
    const packed = process.env.OPENLOBS_PLAN || ''
    if (!packed) result = fail('The plan did not arrive.')
    else {
      const plan = JSON.parse(zlib.gunzipSync(Buffer.from(packed, 'base64'), { maxOutputLength: 400_000 }).toString('utf8'))
      result = await runBoxPlan(plan, AbortSignal.timeout(9 * 60_000), { workRoot: process.env.RUNNER_TEMP || undefined })
    }
  } catch (err: any) {
    result = fail(String(err?.message || 'The plan could not be run.'))
  }
  fs.writeFileSync(out, JSON.stringify(result))
}

main().catch((err) => {
  console.error('OpenLobs runner failed:', err?.message)
  process.exitCode = 1
})
