import { createRunnerServer } from './app'

/**
 * The cloud box worker. Deploy it as its own small service (see docs/deploy.md, "The cloud box"), under a service
 * account with no roles, with one request at a time. It is also what the self-host pack runs.
 *   RUNNER_SECRET  shared secret, at least 24 characters (required)
 *   PORT           default 8080
 *   RUNNER_UID     the ordinary user programs run as (default 10001 when started as root)
 *   RUNNER_KEEP    set to 1 to keep serving after a plan instead of restarting (development only)
 */
const secret = process.env.RUNNER_SECRET || ''
if (secret.length < 24) {
  console.error('RUNNER_SECRET must be set and at least 24 characters. Refusing to start.')
  process.exit(1)
}
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const uid = process.env.RUNNER_UID ? Number(process.env.RUNNER_UID) : isRoot ? 10001 : undefined
if (isRoot && (uid === undefined || !Number.isInteger(uid) || uid <= 0)) {
  console.error('RUNNER_UID must be a positive number. Refusing to start as root without an ordinary user to run programs as.')
  process.exit(1)
}
const keep = process.env.RUNNER_KEEP === '1' && process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 8080)

const server = createRunnerServer({
  secret,
  box: { uid, gid: uid },
  afterPlan: keep ? undefined : () => setTimeout(() => process.exit(0), 200).unref()
})
server.listen(port, () => console.log(`[runner] listening on ${port}${uid ? ` (programs run as user ${uid})` : ''}`))
