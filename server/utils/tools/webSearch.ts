import { tool } from 'ai'
import { z } from 'zod'

const stripTags = (html: string) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim()

/** Extracts titles, URLs and snippets from DuckDuckGo's HTML results page. */
export function parseSearchResults(html: string, limit = 5) {
  const sources: Array<{ title: string, url: string }> = []
  const snippets: string[] = []

  for (const m of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (sources.length >= limit) break
    let url = (m[1] || '').replace(/&amp;/g, '&')
    if (url.includes('uddg=')) {
      try {
        const decoded = new URL(url, 'https://duckduckgo.com').searchParams.get('uddg')
        if (decoded) url = decoded
      } catch { /* keep raw */ }
    }
    const title = stripTags(m[2] || '')
    if (/^https?:\/\//.test(url) && title) sources.push({ title, url })
  }

  for (const m of html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (snippets.length >= limit) break
    const text = stripTags(m[1] || '')
    if (text) snippets.push(text)
  }

  return { sources, snippets }
}

export const webSearchTool = tool({
  description: 'Search the live web for real-time information, recent news, current events, and facts.',
  inputSchema: z.object({
    query: z.string().min(1).max(300).describe('The web search query')
  }),
  execute: async ({ query }) => {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(6000)
      })
      if (!res.ok) throw new Error(`search provider responded with ${res.status}`)

      const { sources, snippets } = parseSearchResults(await res.text())
      if (sources.length === 0) {
        return { query, status: 'empty' as const, sources: [], summary: '', error: 'The search returned no results. Do not guess; tell the user the search found nothing.' }
      }
      return { query, status: 'ok' as const, sources, summary: snippets.join('\n\n') }
    } catch (err: any) {
      console.warn('[web_search] failed:', err?.message)
      return { query, status: 'failed' as const, sources: [], summary: '', error: 'Web search is unavailable right now. Tell the user you could not search and answer only from what you already know, clearly saying so.' }
    }
  }
})
