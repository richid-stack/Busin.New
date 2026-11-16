import fs from 'node:fs'
import path from 'node:path'
import { SHEET_EXTENSIONS, SHEET_LIMITS } from '../shared/sheetOps'

/**
 * The one folder a person lets OpenLobs use. Every file a job names is checked against it: the real location
 * (after following shortcuts and links) must be inside the folder, so "..", other drives and links that lead
 * elsewhere all fail. OpenLobs only ever sends names relative to the folder.
 */
export class WorkspaceError extends Error {}

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p)

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The folder itself, checked: it must exist and be a real directory. Returns its real path. */
export function openWorkspace(folder: string | null | undefined, permission = 'excel'): string {
  if (!folder) throw new WorkspaceError(`No folder has been chosen on this computer. Run: bridge allow ${permission} --folder "C:\\path\\to\\folder"`)
  let real: string
  try { real = fs.realpathSync(folder) } catch { throw new WorkspaceError('The folder chosen on this computer does not exist any more.') }
  if (!fs.statSync(real).isDirectory()) throw new WorkspaceError('The chosen folder is not a folder.')
  if (path.parse(real).root === real) throw new WorkspaceError('A whole drive cannot be used as the folder. Choose a folder inside it.')
  return real
}

/** An existing file inside the folder. */
export function resolveExisting(root: string, rel: string): string {
  const candidate = path.resolve(root, ...rel.split(/[\\/]/))
  if (!isInside(root, candidate)) throw new WorkspaceError('That file is outside the chosen folder.')
  let real: string
  try { real = fs.realpathSync(candidate) } catch { throw new WorkspaceError(`There is no file "${rel}" in the chosen folder.`) }
  if (!isInside(root, real)) throw new WorkspaceError('That file is outside the chosen folder.')
  if (!fs.statSync(real).isFile()) throw new WorkspaceError(`"${rel}" is not a file.`)
  return real
}

/**
 * The real location of the nearest part of a path that already exists. Folders are made only after this is known to be
 * inside the chosen folder, so a link or junction in the middle of the path cannot make folders somewhere else.
 */
function nearestRealAncestor(target: string): string {
  let at = target
  for (;;) {
    try { return fs.realpathSync(at) } catch { /* not there yet, or a link that leads nowhere */ }
    // Something is there but cannot be followed: a link to a place that does not exist yet. Making folders through it would make them at its far end.
    try { fs.lstatSync(at); throw new WorkspaceError('That location is outside the chosen folder.') } catch (err) { if (err instanceof WorkspaceError) throw err }
    const up = path.dirname(at)
    if (up === at) throw new WorkspaceError('That location is outside the chosen folder.')
    at = up
  }
}

/**
 * A place for a new file inside the folder: its parent must be inside, and an existing file is never reused (a number
 * is added). The name is reserved by creating the empty file in the same step that checks it is free, so two jobs
 * cannot choose the same name, and a link (even one that leads nowhere) is never written through. Whoever reserves a
 * name is responsible for removing the file if the job does not finish.
 */
export function newFilePath(root: string, rel: string): { full: string, rel: string } {
  const parts = rel.split(/[\\/]/)
  const parent = path.resolve(root, ...parts.slice(0, -1))
  if (!isInside(root, parent)) throw new WorkspaceError('That location is outside the chosen folder.')
  if (!isInside(root, nearestRealAncestor(parent))) throw new WorkspaceError('That location is outside the chosen folder.')
  fs.mkdirSync(parent, { recursive: true })
  const realParent = fs.realpathSync(parent)
  if (!isInside(root, realParent)) throw new WorkspaceError('That location is outside the chosen folder.')
  const ext = path.extname(parts[parts.length - 1]!)
  const stem = path.basename(parts[parts.length - 1]!, ext)
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem} (${n})${ext}`
    const full = path.join(realParent, name)
    try {
      // "wx" fails if anything is there, including a link, and never follows one.
      fs.closeSync(fs.openSync(full, 'wx'))
      return { full, rel: path.relative(root, full).split(path.sep).join('/') }
    } catch (err: any) {
      if (err?.code === 'EEXIST') continue
      throw new WorkspaceError('A new file could not be created in the chosen folder.')
    }
  }
  throw new WorkspaceError('Too many files with that name already exist.')
}

export interface Listed { name: string, sizeKb: number, modified: string }

/** Spreadsheet files in the folder (and one level of sub-folders), newest first. Links and temporary lock files are skipped. */
export function listSpreadsheets(root: string, sub?: string, stopped: () => boolean = () => false): { files: Listed[], truncated: boolean } {
  const start = sub ? resolveDir(root, sub) : root
  const out: Listed[] = []
  const walk = (dir: string, depth: number) => {
    if (stopped()) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (stopped()) return
      if (e.isSymbolicLink() || e.name.startsWith('.') || e.name.startsWith('~$')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 2) walk(full, depth + 1); continue }
      if (!e.isFile() || !SHEET_EXTENSIONS.some(x => e.name.toLowerCase().endsWith(x))) continue
      try {
        const shown = path.relative(root, full).split(path.sep).join('/')
        if (shown.length > 200) continue // too long to name in a result; it can still be opened by its short path
        const st = fs.statSync(full)
        out.push({ name: shown, sizeKb: Math.ceil(st.size / 1024), modified: st.mtime.toISOString() })
      } catch { /* vanished while listing */ }
    }
  }
  walk(start, 1)
  out.sort((a, b) => b.modified.localeCompare(a.modified))
  return { files: out.slice(0, SHEET_LIMITS.maxListed), truncated: out.length > SHEET_LIMITS.maxListed }
}

export function resolveDir(root: string, rel: string): string {
  const candidate = path.resolve(root, ...rel.split(/[\\/]/))
  let real: string
  try { real = fs.realpathSync(candidate) } catch { throw new WorkspaceError(`There is no folder "${rel}" in the chosen folder.`) }
  if (!isInside(root, real) || !fs.statSync(real).isDirectory()) throw new WorkspaceError('That folder is outside the chosen folder.')
  return real
}
