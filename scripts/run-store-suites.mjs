// Runs the store test suites against the real Firestore emulator (TEST_FIRESTORE=emulator), one after the other, and
// reports every one that fails instead of stopping at the first, so a single run shows all the differences.
// Suites that peek inside the in-memory stand-in with raw() cannot run on the real database and are not listed.
import { spawnSync } from 'node:child_process'

const only = (process.env.STORE_SUITES ?? '').split(',').filter(Boolean)
const suites = (process.argv.slice(2).length ? process.argv.slice(2) : only.length ? only : [
  'usage', 'memory', 'modelProviders', 'integrations', 'taskPause', 'taskSchedules',
  'reefCommunity', 'reefRoutes', 'reefSeed', 'browserHolds', 'bridgeLive', 'bridgeRunJobs'
])
const failed = []
for (const name of suites) {
  const r = // `timeout` stops the whole group of processes after 80 seconds, so a suite that hangs cannot hang the run.
  spawnSync('timeout', ['-k', '5', '80', './node_modules/.bin/tsx', `tests/${name}.test.mts`], { env: { ...process.env, TEST_FIRESTORE: 'emulator' }, encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const lines = out.split(/\r?\n/)
  const fails = lines.filter(l => /^FAIL/.test(l))
  const passes = lines.filter(l => /^PASS/.test(l)).length
  const hung = r.status === 124 || r.status === 137
  const bad = r.status !== 0 || fails.length > 0
  console.log(`${bad ? '✗' : '✓'} ${name}: ${passes} passed, ${fails.length} failed${r.status !== 0 ? ` (${hung ? 'did not finish in 80 seconds' : `exit ${r.status}`})` : ''}`)
  if (bad) {
    failed.push(name)
    for (const f of fails.slice(0, 12)) console.log(`    ${f}`)
    const lastPass = lines.filter(l => /^(PASS|FAIL|input)/.test(l)).slice(-12)
    for (const l of lastPass) console.log(`    last passing: ${l}`)
    // The lines of the error that point into this project (not the libraries) show where it happened.
    const mine = lines.filter(l => /\s+at .*\/(tests|server|shared|bridge)\//.test(l) && !l.includes('node_modules')).slice(0, 8)
    for (const l of mine) console.log(`    ${l.trim()}`)
    const msg = lines.filter(l => /Error|error|details:|Unhandled/.test(l) && !/^\s+at /.test(l)).slice(0, 6)
    for (const l of msg) console.log(`    ${l.trim().slice(0, 300)}`)
  }
}
console.log(failed.length ? `\nDifferent on the real database: ${failed.join(', ')}` : '\nAll suites behave the same on the real database.')
process.exit(failed.length ? 1 : 0)
