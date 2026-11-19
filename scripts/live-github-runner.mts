// Proves "run on your GitHub" against the real api.github.com, with a real repo and a real token.
// It connects, writes the runner into the repo, runs two small plans on GitHub's machines, and checks that each run was
// deleted afterwards. It prints no token. Start it from the Actions tab: "live-github-runner". The repository secret
// OPENLOBS_RUNNER_TEST_TOKEN must hold a fine-grained token for ONE private repo named openlobs-runs (Actions, Contents
// and Workflows: read and write). Use a throwaway repo; nothing in it is kept.
import { appendFileSync } from 'node:fs'
import { checkConnection, githubBox, installRunner } from '../server/services/cloudbox/github'
import { WORKFLOW_FILE } from '../server/services/cloudbox/githubWorkflow'

const token = process.env.OPENLOBS_RUNNER_TEST_TOKEN?.trim()
if (!token) { console.error('FAIL OPENLOBS_RUNNER_TEST_TOKEN is not set, so nothing could be checked against GitHub.'); process.exit(1) }

let failures = 0
const rows: string[] = []
const check = (ok: boolean, what: string) => { console.log(ok ? 'PASS' : 'FAIL', what); rows.push(`| ${ok ? 'pass' : '**FAIL**'} | ${what} |`); if (!ok) failures++ }

try {
  const conn = await checkConnection(token)
  check(conn.repo === 'openlobs-runs', `the token reaches only ${conn.login}/${conn.repo}, which is private and writable`)
  const t0 = Date.now()
  const installed = await installRunner(token, conn)
  check(true, `the runner is in the repo (${installed.changed ? 'written now' : 'already current'}), ${(Date.now() - t0) / 1000}s`)

  const box = githubBox(conn, token)
  const run = (plan: unknown) => box.run(plan, AbortSignal.timeout(280_000))

  const good = await run({
    steps: [{ program: 'node', args: ['hello.js'], why: 'Say hello' }],
    files: [{ path: 'hello.js', content: 'console.log("live-check", process.platform, Object.keys(process.env).some(k => /TOKEN|OPENLOBS/.test(k)))' }],
    limitMs: 120_000
  })
  const out = good.steps[0]?.output ?? ''
  check(good.steps.length === 1 && good.steps[0]!.exitCode === 0 && /^live-check linux false/.test(out), `a plan ran on GitHub's machine and printed: ${out.trim().slice(0, 60)}`)
  check(good.minutes >= 1 && good.seconds > 0, `it took ${good.seconds}s and counts as ${good.minutes} GitHub minute(s)`)

  const bad = await run({
    steps: [{ program: 'node', args: ['bad.js'], why: 'Fail on purpose' }, { program: 'node', args: ['bad.js'], why: 'Never reached' }],
    files: [{ path: 'bad.js', content: 'console.error("on purpose"); process.exit(3)' }],
    limitMs: 120_000
  })
  check(bad.steps.length === 1 && bad.steps[0]!.exitCode === 3, 'a failing step came back with its exit code and the plan stopped there')

  // Nothing of ours is left in the repo: both runs were deleted once their results were read.
  const left = await fetch(`https://api.github.com/repos/${conn.login}/${conn.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=20`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OpenLobs' }
  }).then(r => r.json() as Promise<any>)
  const mine = (left.workflow_runs ?? []).filter((r: any) => /^openlobs /.test(String(r.display_title)))
  check(mine.length === 0, `no OpenLobs runs are left in the repo (${mine.length} found)`)
} catch (err: any) {
  console.error('FAIL', err?.name, err?.message)
  rows.push(`| **FAIL** | stopped by: ${String(err?.message ?? err).replace(/\|/g, '/').slice(0, 200)} |`)
  failures++
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Run on your GitHub, against real GitHub\n\n| | Check |\n|---|---|\n${rows.join('\n')}\n`)
console.log(failures ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
