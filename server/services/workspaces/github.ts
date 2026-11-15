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
