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
