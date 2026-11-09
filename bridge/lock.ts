import fs from 'node:fs'
import path from 'node:path'

/**
 * Only one Bridge runs per computer: a second one would just double the polling and could take the same jobs.
 *
 * The lock is a file made with "create only if it is not there", so two Bridges that start together cannot both
 * get it. A lock left behind by a Bridge that was killed is told apart from a live one by a heartbeat: a running
 * Bridge rewrites its state file twice a second, so a lock whose owner is gone, or has not been heard from for
 * 20 seconds, is old. (A process number alone proves nothing: Windows reuses them.)
 */
export const LOCK_STALE_MS = 20_000

export interface LockDeps {
  pid?: number
  now?: () => number
  /** Replaceable in tests. */
  isAlive?: (pid: number) => boolean
}

const defaultAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch (err: any) { return err?.code === 'EPERM' } }

const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return 0 } }

/** Takes the lock, or throws "The Bridge is already running on this computer." Returns a function that gives it back. */
export function takeLock(dir: string, deps: LockDeps = {}): () => void {
  const pid = deps.pid ?? process.pid
  const now = deps.now ?? Date.now
  const alive = deps.isAlive ?? defaultAlive
  const lockFile = path.join(dir, 'run.lock')
  const stateFile = path.join(dir, 'state.json')
  fs.mkdirSync(dir, { recursive: true })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      try { fs.writeSync(fd, String(pid)) } finally { fs.closeSync(fd) }
      return () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === pid) fs.rmSync(lockFile, { force: true }) } catch { /* already gone */ } }
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err
    }
    let seen = ''
    try { seen = fs.readFileSync(lockFile, 'utf8') } catch { continue } // it vanished: try to take it again
    const owner = Number(seen)
    const lastHeard = Math.max(mtime(lockFile), mtime(stateFile))
    const live = owner > 0 && owner !== pid && alive(owner) && now() - lastHeard < LOCK_STALE_MS
    if (live) throw new Error('The Bridge is already running on this computer.')
    // Old lock. It is removed only if it is still the one that was judged, so a Bridge that just took it is not undone.
    try { if (fs.readFileSync(lockFile, 'utf8') === seen) fs.rmSync(lockFile, { force: true }) } catch { /* someone else dealt with it */ }
  }
  throw new Error('The Bridge is already running on this computer.')
}
