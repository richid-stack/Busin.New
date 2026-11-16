import { safeFetch } from '../../utils/netSafety'
import { REPO_NAME, githubGetter } from '../../utils/tools/githubRead'
import type { GithubFetcher } from '../../utils/tools/githubRead'
import { MAX_FILE_CHARS, WorkspaceError } from './profile'

/** "https://github.com/owner/name/tree/main/docs", "github.com/owner/name.git" or "owner/name" all give { owner, name }. */
export function parseRepo(raw: string): { owner: string, name: string } {
  const trimmed = raw.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '')
  const [owner, rawName] = trimmed.split(/[/?#]/)
  const name = (rawName ?? '').replace(/\.git$/i, '')
  if (!owner || !name || !/^[A-Za-z0-9-]{1,39}$/.test(owner) || !REPO_NAME.test(name)) throw new WorkspaceError('Paste a GitHub address like github.com/owner/name.')
  return { owner, name }
}

/**
 * Reads a public repository into one text file: what it is, its top-level files and its README.
 * Public only: a private one answers "not found", and the message says what to do. Read-only; nothing is cloned.
 */
export async function importRepo(raw: string, fetcher: GithubFetcher = safeFetch as GithubFetcher, env: NodeJS.ProcessEnv = process.env): Promise<{ name: string, text: string, from: string }> {
  const { owner, name } = parseRepo(raw)
  const get = githubGetter(fetcher, env)
  const base = `https://api.github.com/repos/${owner}/${name}`
  let meta: any
  try {
    meta = await get(base)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (/Not found/i.test(message)) throw new WorkspaceError('That repository was not found. Private repositories cannot be added yet; only public ones.', 404)
    throw new WorkspaceError(message || 'The repository could not be read.', 502)
  }
  const lines = [`Repository: ${meta.full_name ?? `${owner}/${name}`}`]
  if (meta.description) lines.push(`About: ${String(meta.description)}`)
  if (meta.language) lines.push(`Main language: ${String(meta.language)}`)
  try {
    const top = await get(`${base}/contents`)
    if (Array.isArray(top)) lines.push('', 'Top-level files:', ...top.slice(0, 80).map((e: any) => `- ${String(e.name)}${e.type === 'dir' ? '/' : ''}`))
  } catch { /* the README alone is still useful */ }
  try {
    const r = await get(`${base}/readme`)
    if (typeof r.content === 'string') lines.push('', 'README:', Buffer.from(r.content, 'base64').toString('utf8').slice(0, MAX_FILE_CHARS))
  } catch { /* a repository without a README is fine */ }
  return { name: `${owner}-${name}.md`, text: lines.join('\n'), from: `${owner}/${name}` }
}

// ---- Picking parts of a repository --------------------------------------------------------------

/** Files whose text is worth keeping. Everything else (images, builds, lock files) is skipped. */
const TEXT_FILE = /\.(md|mdx|txt|rst|json|ya?ml|toml|csv|html?|css|scss|vue|svelte|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|php|sh|sql|xml|ini|env\.example)$|(^|\/)(README|LICENSE|Dockerfile|Makefile)[^/]*$/i
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|\.next|\.nuxt|vendor|coverage)(\/|$)/
const SKIP_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|.*\.min\.(js|css))$/
/** Most files and bytes read for one import: it is one request on shared limits, not a clone. */
export const MAX_IMPORT_FILES = 40
export const MAX_IMPORT_BYTES = 1_500_000

export interface RepoEntry { name: string, dir: boolean, bytes: number, files: number }

interface Tree { owner: string, name: string, branch: string, blobs: Array<{ path: string, size: number }> }

async function readTree(raw: string, fetcher: GithubFetcher, env: NodeJS.ProcessEnv): Promise<Tree> {
  const { owner, name } = parseRepo(raw)
  const get = githubGetter(fetcher, env)
  const base = `https://api.github.com/repos/${owner}/${name}`
  try {
    const meta = await get(base)
    const branch = String(meta.default_branch || 'main')
    const tree = await get(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
    const blobs = (Array.isArray(tree.tree) ? tree.tree : [])
      .filter((e: any) => e.type === 'blob' && typeof e.path === 'string' && !SKIP_DIR.test(e.path) && !SKIP_FILE.test(e.path) && TEXT_FILE.test(e.path))
      .map((e: any) => ({ path: String(e.path), size: Number(e.size) || 0 }))
    return { owner, name, branch, blobs }
  } catch (err: any) {
    const message = String(err?.message || '')
    if (err instanceof WorkspaceError) throw err
    if (/Not found/i.test(message)) throw new WorkspaceError('That repository was not found. Private repositories cannot be added yet; only public ones.', 404)
    throw new WorkspaceError(message || 'The repository could not be read.', 502)
  }
}

/** The top level of a public repository with how much readable text each folder holds, so the person can pick. */
export async function listRepo(raw: string, fetcher: GithubFetcher = safeFetch as GithubFetcher, env: NodeJS.ProcessEnv = process.env): Promise<{ repo: string, entries: RepoEntry[] }> {
  const { owner, name, blobs } = await readTree(raw, fetcher, env)
  const top = new Map<string, RepoEntry>()
  for (const b of blobs) {
    const [first, ...rest] = b.path.split('/')
    const dir = rest.length > 0
    const entry = top.get(first!) ?? { name: first!, dir, bytes: 0, files: 0 }
    entry.bytes += b.size
    entry.files += 1
    top.set(first!, entry)
  }
  const entries = [...top.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  return { repo: `${owner}/${name}`, entries }
}

/** Reads the chosen top-level files and folders into one text file, each file under a "=== path ===" line. */
export async function importPaths(raw: string, picked: string[], fetcher: GithubFetcher = safeFetch as GithubFetcher, env: NodeJS.ProcessEnv = process.env): Promise<{ name: string, text: string, from: string }> {
  const tree = await readTree(raw, fetcher, env)
  const wanted = new Set(picked.map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean))
  if (!wanted.size) throw new WorkspaceError('Pick at least one file or folder.')
  const chosen = tree.blobs.filter(b => wanted.has(b.path.split('/')[0]!))
  if (!chosen.length) throw new WorkspaceError('Nothing readable was found in what you picked.')
  let bytes = 0
  const files = chosen.slice(0, MAX_IMPORT_FILES).filter((b) => {
    if (bytes + b.size > MAX_IMPORT_BYTES) return false
    bytes += b.size
    return true
  })
  const parts: string[] = []
  for (const f of files) {
    try {
      const res = await fetcher(`https://raw.githubusercontent.com/${tree.owner}/${tree.name}/${encodeURIComponent(tree.branch)}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { maxBytes: 400_000, timeoutMs: 15_000 })
      if (res.status !== 200 || res.body.subarray(0, 4000).includes(0)) continue
      parts.push(`=== ${f.path} ===\n${res.body.toString('utf8').trim()}`)
    } catch { /* one unreadable file should not stop the rest */ }
  }
  if (!parts.length) throw new WorkspaceError('Nothing readable was found in what you picked.')
  const label = picked.length === 1 ? picked[0]!.replace(/[^\w.-]+/g, '-') : `${picked.length}-items`
  return { name: `${tree.owner}-${tree.name} (${label}).md`, text: [`Repository: ${tree.owner}/${tree.name}`, ...parts].join('\n\n'), from: `${tree.owner}/${tree.name}` }
}
