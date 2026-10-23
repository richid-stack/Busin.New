import fs from 'node:fs'
import path from 'node:path'

/**
 * How the tray icon (or the command line) talks to the running Bridge, without any network port: a few small
 * files in the Bridge's own folder. Whoever can write there is already this person, on this computer.
 *   paused.flag   exists  -> everything stops now and nothing new is accepted
 *   quit.flag     exists  -> the Bridge shuts down
 *   state.json    written by the Bridge once or twice a second, so the tray can show what is going on
 */
export interface BridgeState {
  version: string
  name: string
  server: string
  connected: boolean
  paused: boolean
  /** What it is doing right now (a fixed label from the Bridge's own list), or null. */
  busy: string | null
  at: string
}

export interface Control {
  paused: () => boolean
  quitRequested: () => boolean
  publish: (state: BridgeState) => void
}

export function fileControl(dir: string): Control {
  const pausedFile = path.join(dir, 'paused.flag')
  const quitFile = path.join(dir, 'quit.flag')
  const stateFile = path.join(dir, 'state.json')
  return {
    paused: () => fs.existsSync(pausedFile),
    quitRequested: () => fs.existsSync(quitFile),
    publish: (state) => {
      try {
        fs.mkdirSync(dir, { recursive: true })
        const tmp = `${stateFile}.${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(state))
        fs.renameSync(tmp, stateFile)
      } catch { /* the tray is a convenience; it must never stop the Bridge */ }
    }
  }
}

export const setPaused = (dir: string, paused: boolean) => {
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, 'paused.flag')
  if (paused) fs.writeFileSync(f, new Date().toISOString())
  else fs.rmSync(f, { force: true })
}
export const clearQuit = (dir: string) => fs.rmSync(path.join(dir, 'quit.flag'), { force: true })
export const requestQuit = (dir: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'quit.flag'), new Date().toISOString()) }
