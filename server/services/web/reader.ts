import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'
import { parseSafeUrl, safeFetch, UnsafeUrlError } from '../../utils/netSafety'

export interface PageResult {
  url: string
  title: string
  markdown: string
  /** Which reader produced the text. */
  source: 'firecrawl' | 'reader'
  /** Set when Firecrawl was tried first and the free reader had to take over. */
  fallbackReason?: string
}

export class PageError extends Error {}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'])
turndown.remove(node => node.nodeName.toLowerCase() === 'svg')

/** Elements a human never sees; text hidden in them is a common place to plant instructions for an AI. */
const HIDDEN = '[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"],script,style,noscript,template,iframe,svg'

const tidy = (text: string) => text.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** Turns an HTML page into clean markdown: the article if there is one, otherwise the visible body. */
export function extractPage(html: string, url: string): { title: string, markdown: string } {
  const { document } = parseHTML(html)
  document.querySelectorAll(HIDDEN).forEach((el: Element) => el.remove())

  const title = tidy(document.querySelector('title')?.textContent || document.querySelector('h1')?.textContent || '')
  let markdown = ''
  try {
    // Readability needs a base URL to turn relative links into absolute ones.
    const base = document.createElement('base')
    base.setAttribute('href', url)
    document.head?.appendChild(base)
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse()
    if (article?.content) markdown = turndown.turndown(article.content)
  } catch { /* fall through to the plain body */ }

  if (markdown.trim().length < 200) {
    const body = document.body?.innerHTML || ''
    const plain = body ? turndown.turndown(body) : ''
    if (plain.trim().length > markdown.trim().length) markdown = plain
  }
  return { title, markdown: tidy(markdown) }
}

interface FirecrawlOptions { apiKey: string, signal?: AbortSignal, fetchImpl?: typeof fetch }

/** Reads one page through Firecrawl (handles JavaScript-heavy sites and anti-bot pages). */
export async function firecrawlScrape(url: string, { apiKey, signal, fetchImpl = fetch }: FirecrawlOptions): Promise<PageResult> {
  const res = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 20_000 }),
    signal
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || !json?.success) {
    throw Object.assign(new Error(json?.error || `Firecrawl responded with ${res.status}`), { status: res.status })
  }
  const status = Number(json.data?.metadata?.statusCode ?? 200)
  if (status >= 400) throw new PageError(`The page responded with status ${status}.`)
  const title = json.data?.metadata?.title
  return {
    url: json.data?.metadata?.url || url,
    title: tidy(Array.isArray(title) ? String(title[0] ?? '') : String(title ?? '')),
    markdown: tidy(String(json.data?.markdown ?? '')),
    source: 'firecrawl'
  }
}

/** Reads one page with no third party: our own guarded fetch plus the extractor. */
export async function readerScrape(url: string, signal?: AbortSignal): Promise<PageResult> {
  const page = await safeFetch(url, { signal, maxBytes: 2_000_000, timeoutMs: 12_000 })
  if (page.status >= 400) throw new PageError(`The page responded with status ${page.status}.`)

  const type = page.contentType.toLowerCase()
  const text = page.body.toString('utf8')
  if (type.includes('html') || /^\s*<(!doctype|html)/i.test(text)) {
    const { title, markdown } = extractPage(text, page.url)
    if (!markdown) throw new PageError('No readable text was found on that page (it may need JavaScript to load).')
    return { url: page.url, title, markdown, source: 'reader' }
  }
  if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) {
    return { url: page.url, title: '', markdown: tidy(text), source: 'reader' }
  }
  throw new PageError(`That link is a ${type.split(';')[0] || 'binary'} file, which cannot be read as text yet.`)
}

/** Status codes where trying the free reader instead is worthwhile (quota, outage, timeout). */
const FALLBACK_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504])

/** Reads a page: Firecrawl when a key is set, otherwise (or when it is unavailable) the free reader. */
export async function readPage(rawUrl: string, signal?: AbortSignal, env: { FIRECRAWL_API_KEY?: string } = process.env): Promise<PageResult> {
  // Shape check first, so nothing internal is ever handed to a third party either.
  const url = parseSafeUrl(rawUrl).href
  const apiKey = env.FIRECRAWL_API_KEY?.trim()

  if (apiKey) {
    try {
      return await firecrawlScrape(url, { apiKey, signal })
    } catch (err: any) {
      if (err instanceof PageError || err instanceof UnsafeUrlError) throw err
      if (signal?.aborted) throw err
      const status = Number(err?.status)
      if (status && !FALLBACK_STATUSES.has(status)) throw err
      const reason = status === 402 || status === 429 ? 'Firecrawl quota reached' : 'Firecrawl unavailable'
      console.warn(`[web_fetch] ${reason}; using the free reader:`, err?.message)
      const page = await readerScrape(url, signal)
      return { ...page, fallbackReason: reason }
    }
  }
  return await readerScrape(url, signal)
}
