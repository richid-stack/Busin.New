// Runs the store test suites against the real Firestore emulator (TEST_FIRESTORE=emulator), one after the other, and
// reports every one that fails instead of stopping at the first, so a single run shows all the differences.
// Suites that peek inside the in-memory stand-in with raw() cannot run on the real database and are not listed.
import { spawnSync } from 'node:child_process'

const suites = (process.argv.slice(2).length ? process.argv.slice(2) : [
  'usage', 'memory', 'modelProviders', 'integrations', 'taskPause', 'taskSchedules',
  'reefCommunity', 'reefRoutes', 'reefSeed', 'browserHolds', 'bridgeLive', 'bridgeRunJobs'
])
const failed = []
for (const name of suites) {
  const r = spawnSync('npx', ['tsx', `tests/${name}.test.mts`], { env: { ...process.env, TEST_FIRESTORE: 'emulator' }, encoding: 'utf8', shell: process.platform === 'win32', timeout: 90_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const lines = out.split(/\r?\n/)
  const fails = lines.filter(l => /^FAIL/.test(l))
  const passes = lines.filter(l => /^PASS/.test(l)).length
  const bad = r.status !== 0 || fails.length > 0
  console.log(`${bad ? '✗' : '✓'} ${name}: ${passes} passed, ${fails.length} failed${r.status !== 0 ? ` (exit ${r.status}${r.error ? ', ' + r.error.message : ''})` : ''}`)
  if (bad) {
    failed.push(name)
    for (const f of fails.slice(0, 12)) console.log(`    ${f}`)
    if (!fails.length) console.log(out.split('\n').slice(-25).map(l => `    ${l}`).join('\n'))
  }
}
console.log(failed.length ? `\nDifferent on the real database: ${failed.join(', ')}` : '\nAll suites behave the same on the real database.')
process.exit(failed.length ? 1 : 0)
