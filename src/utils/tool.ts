import type { getToolName } from 'ai'
import { getDomain, getFaviconUrl } from './url'

export interface Source {
  url: string
  title?: string
}

interface GoogleGroundingChunk {
  web?: { uri?: string, title?: string }
}

interface SearchOutput {
  sources?: { url: string, type?: string }[]
  groundingChunks?: GoogleGroundingChunk[]
  groundingMetadata?: { groundingChunks?: GoogleGroundingChunk[] }
}

type ToolPart = Parameters<typeof getToolName>[0]

export function getSearchQuery(part: ToolPart): string | undefined {
  return (part.input as { query?: string } | undefined)?.query
}

/** 'failed' or 'empty' when our own search tool could not produce sources. */
export function getSearchProblem(part: ToolPart): 'failed' | 'empty' | null {
  const status = (part.output as { status?: string } | undefined)?.status
  return status === 'failed' || status === 'empty' ? status : null
}

export function getSources(part: ToolPart): Source[] {
  const output = part.output
  if (!output) return []

  // Anthropic: array of { url, title }
  if (Array.isArray(output)) {
    return output.filter((s: Source) => s.url).map((s: Source) => ({ url: s.url, title: s.title }))
  }

  const typed = output as SearchOutput

  // OpenAI: { sources: [{ type: 'url', url }] }
  if (typed.sources) {
    return typed.sources.filter(s => s.url).map(s => ({ url: s.url }))
  }

  // Google: grounding chunks with { web: { uri, title } }
  const chunks = typed.groundingChunks ?? typed.groundingMetadata?.groundingChunks
  if (chunks) {
    return chunks.filter(c => c.web?.uri).map(c => ({ url: c.web!.uri!, title: c.web!.title }))
  }

  return []
}

export function sourceToInlineMdc(url: string): string {
  const domain = getDomain(url)
  const favicon = getFaviconUrl(url)
  const safeUrl = url.replace(/"/g, '&quot;')
  const safeFavicon = favicon.replace(/"/g, '&quot;')

  return ` :source-link{url="${safeUrl}" favicon="${safeFavicon}" label="${domain}"}`
}

/** What the page-reading tool did: the page it opened, or why it could not. */
export function getFetchedPage(part: ToolPart): { source: Source | null, failed: boolean, url?: string } {
  const output = part.output as { status?: string, url?: string, title?: string } | undefined
  const requested = (part.input as { url?: string } | undefined)?.url
  if (!output) return { source: null, failed: false, url: requested }
  if (output.status === 'failed') return { source: null, failed: true, url: requested }
  const url = output.url || requested
  return { source: url ? { url, title: output.title || undefined } : null, failed: false, url }
}

/** The skill a load_skill call opened, as a readable name; undefined while loading or on failure. */
export function getSkillName(part: ToolPart): string | undefined {
  const output = part.output as { status?: string, name?: string } | undefined
  const name = output?.status === 'ok' ? output.name : undefined
  return name?.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
}

/** What a read_document call opened: the file name, and whether it failed. */
export function getDocumentRead(part: ToolPart): { file?: string, failed: boolean } {
  const output = part.output as { status?: string, file?: string } | undefined
  const input = part.input as { file?: string } | undefined
  return { file: output?.file ?? input?.file, failed: output?.status === 'failed' }
}

/** What a fetch_file or view_image call handled: the file, where it came from, and whether it failed. */
export function getFileTrace(part: ToolPart): { name?: string, source?: string, fileId?: string, isImage: boolean, failed: boolean, error?: string } {
  const output = part.output as { status?: string, name?: string, source?: string, fileId?: string, mime?: string, kind?: string, error?: string } | undefined
  const input = part.input as { url?: string, name?: string } | undefined
  let host: string | undefined
  try { host = input?.url ? new URL(input.url).hostname : undefined } catch { host = undefined }
  const failed = output?.status === 'failed'
  return {
    name: output?.name ?? input?.name,
    source: output?.source ?? host,
    fileId: failed ? undefined : output?.fileId,
    isImage: !failed && (output?.kind === 'image' || Boolean(output?.mime?.startsWith('image/'))),
    failed,
    error: failed ? plainError(output?.error) : undefined
  }
}

/** What a look_at_page or design_tokens call found: the picture, or the colours and fonts. */
export function getPageTrace(part: ToolPart): { source?: string, fileId?: string, title?: string, colors: { hex: string, role: string }[], fonts: string[], failed: boolean, error?: string } {
  const output = part.output as { status?: string, source?: string, fileId?: string, title?: string, colors?: { hex: string, role: string }[], fonts?: { family: string }[], error?: string } | undefined
  const input = part.input as { url?: string } | undefined
  let host: string | undefined
  try { host = input?.url ? new URL(input.url).hostname : undefined } catch { host = undefined }
  const failed = output?.status === 'failed'
  return {
    source: output?.source || host,
    fileId: failed ? undefined : output?.fileId,
    title: output?.title,
    colors: failed ? [] : (output?.colors ?? []).slice(0, 10),
    fonts: failed ? [] : (output?.fonts ?? []).map(f => f.family).slice(0, 4),
    failed,
    error: failed ? plainError(output?.error) : undefined
  }
}

/** A failure message for the person: the sentences written only for the model (telling it what to do next) are left out. */
function plainError(message: string | undefined): string | undefined {
  if (!message) return undefined
  return message.replace(/\s*(Tell the user|Ask the user|Tell them)[^.]*\.(\s*Do not guess[^.]*\.)?/g, '').replace(/\s*and do not guess[^.]*\./gi, '.').trim() || undefined
}

/** What an asset or code lookup found, as short lines for the trace: icon sets, fonts, repository paths or Reef projects. */
export function getLookupTrace(part: ToolPart): { query?: string, count?: number, summary?: string, lines: string[], failed: boolean, error?: string } {
  const output = part.output as { status?: string, query?: string, count?: number, icons?: { name: string, licence: string }[], fonts?: { family: string, category: string }[], projects?: { id: string, installs: number, stars: number }[], skills?: { repo: string, stars: number, licence: string }[], builtIn?: { name: string }[], cards?: { name: string, stateLabel: string, risk: string, next: string }[], summary?: string, instructions?: string, description?: string, warnings?: string[], source?: string, name?: string, repo?: string, path?: string, kind?: string, entries?: { name: string, type: string }[], error?: string } | undefined
  const input = part.input as { query?: string, repo?: string, path?: string, folder?: string } | undefined
  const failed = output?.status === 'failed'
  let lines: string[] = []
  if (!failed && output) {
    if (output.icons) lines = output.icons.map(i => `${i.name} · ${i.licence}`)
    else if (output.fonts) lines = output.fonts.map(f => `${f.family} · ${f.category}`)
    else if (output.cards) lines = output.cards.map(c => `${c.name} · ${c.stateLabel}${c.risk === 'changes' ? ' · can change things' : ''}`)
    else if (output.skills || output.builtIn) lines = [...(output.builtIn ?? []).map(b => `${b.name} · built in`), ...(output.skills ?? []).map(k => `${k.repo} · ${k.stars} stars · ${k.licence}`)]
    else if (typeof output.instructions === 'string') lines = [output.description ?? '', ...(output.warnings ?? []).map(w => `Warning: ${w}`)].filter(Boolean)
    else if (output.projects) lines = output.projects.map(p => `${p.id} · ${p.installs} installs · ${p.stars} stars`)
    else if (output.entries) lines = output.entries.map(e => `${e.type === 'folder' ? '▸' : '·'} ${e.name}`)
  }
  const where = input?.repo ? [input.repo, input.path ?? (input as { folder?: string }).folder].filter(Boolean).join('/') : undefined
  return { summary: failed ? undefined : output?.summary, query: (!failed && output?.name ? `${output.name} · ${output.source ?? where}` : undefined) ?? input?.query ?? where ?? output?.query, count: output?.count, lines: lines.slice(0, 16), failed, error: failed ? plainError(output?.error) : undefined }
}

export interface RunStepTrace { n: number, words: string, command: string, ok: boolean, timedOut: boolean, seconds: number, output: string, outputTruncated: boolean }

/** What a plan of commands did on the person's computer: each step in everyday words, with what it printed one click away. */
export function getRunTrace(part: ToolPart): { steps: RunStepTrace[], computer?: string, summary?: string, failed: boolean, stopped: boolean, notRun: number, error?: string, planned: number } {
  const output = part.output as { status?: string, computer?: string, steps?: RunStepTrace[], notRun?: number, error?: string } | undefined
  const input = part.input as { steps?: unknown[] } | undefined
  const steps = Array.isArray(output?.steps) ? output!.steps : []
  const failed = output?.status === 'failed'
  const stopped = output?.status === 'stopped'
  const done = steps.length
  const planned = Array.isArray(input?.steps) ? input!.steps.length : done
  return {
    steps,
    computer: output?.computer,
    summary: [output?.computer, (failed || stopped) && done ? `${done} of ${planned} ${planned === 1 ? 'step' : 'steps'} run` : undefined].filter(Boolean).join(' · ') || undefined,
    failed,
    stopped,
    notRun: output?.notRun ?? 0,
    planned,
    error: failed ? plainError(output?.error) : undefined
  }
}

/** Looking in the chosen folder, one row per thing looked at: a short label, then the name. */
export function getFolderTrace(part: ToolPart): { rows: { verb: string, name: string }[], title: string, summary?: string, failed: boolean, error?: string } {
  const output = part.output as { status?: string, computer?: string, entries?: { name: string, type: string }[], path?: string, name?: string, error?: string } | undefined
  const failed = output?.status === 'failed'
  if (failed || !output) return { rows: [], title: 'Looked in your folder', failed, error: plainError(output?.error) }
  if (output.entries) {
    const files = output.entries.filter(e => e.type === 'file').length
    const folders = output.entries.length - files
    const where = output.path && output.path !== '.' ? output.path : 'your folder'
    return {
      title: 'Looked in your folder',
      rows: [{ verb: 'Listed', name: where }, ...output.entries.slice(0, 40).map(e => ({ verb: '', name: e.name }))],
      summary: [output.computer, `${files} ${files === 1 ? 'file' : 'files'}${folders ? `, ${folders} ${folders === 1 ? 'folder' : 'folders'}` : ''}`].filter(Boolean).join(' · '),
      failed: false
    }
  }
  return { title: 'Read a file on your computer', rows: output.name ? [{ verb: 'Read file', name: output.name }] : [], summary: output.computer, failed: false }
}

/** Adding a tool server, one row per thing that happened: a short label, then the name, then the tools found. */
export function getServerTrace(part: ToolPart): { rows: { verb: string, name: string, plain?: boolean }[], title: string, summary?: string, failed: boolean, error?: string } {
  const o = part.output as { status?: string, name?: string, host?: string, tools?: string[], toolCount?: number, more?: number, approved?: number, next?: string, error?: string } | undefined
  const name = o?.name || 'tool server'
  if (!o || o.status === 'failed' || o.status === 'unknown') return { rows: [], title: `Could not add ${name}`, failed: true, error: plainError(o?.error) }
  if (o.status === 'needs_key') return { rows: [{ verb: 'Needs a key', name, plain: true }], title: `${name} needs a key`, summary: 'Added in Integrations', failed: false, error: o.next }
  if (o.status === 'already_added') return { rows: [{ verb: 'Already added', name, plain: true }], title: `${name} is already added`, summary: o.host, failed: false }
  const tools = o.tools ?? []
  return {
    title: `Added ${name}`,
    summary: `${o.toolCount ?? tools.length} ${(o.toolCount ?? tools.length) === 1 ? 'tool' : 'tools'} to review`,
    rows: [
      ...(o.host ? [{ verb: 'Reached', name: o.host }] : []),
      { verb: 'Added', name, plain: true },
      { verb: 'Found tools', name: '' },
      ...tools.map(t => ({ verb: '', name: t })),
      ...(o.more ? [{ verb: '', name: `and ${o.more} more` }] : [])
    ],
    failed: false
  }
}

/** Keeping a skill, one row per thing that happened: a short label, then the name. */
export function getKeepTrace(part: ToolPart): { rows: { verb: string, name: string, plain?: boolean }[], title: string, summary?: string, failed: boolean, error?: string } {
  const o = part.output as { status?: string, name?: string, source?: string, warnings?: string[], error?: string } | undefined
  const name = o?.name || 'the skill'
  if (!o || o.status !== 'installed') return { rows: [], title: `Could not keep ${name}`, failed: true, error: plainError(o?.error) }
  return {
    title: `Kept ${name}`,
    summary: o.warnings?.length ? `In every chat · ${o.warnings.length} ${o.warnings.length === 1 ? 'warning' : 'warnings'}` : 'In every chat',
    rows: [
      ...(o.source ? [{ verb: 'Read', name: o.source }] : []),
      { verb: 'Checked', name, plain: true },
      { verb: 'Kept', name, plain: true }
    ],
    failed: false
  }
}

/** The rows for a trace that lists what was looked at or done: the folder, a tool server, or a kept skill. */
export const getRowsTrace = (part: ToolPart) => {
  const type = (part as { type?: string }).type
  return type === 'tool-add_tool_server' ? getServerTrace(part) : type === 'tool-install_skill' ? getKeepTrace(part) : getFolderTrace(part)
}
