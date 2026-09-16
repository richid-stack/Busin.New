import { tool } from 'ai'
import { z } from 'zod'

export const webSearchTool = tool({
  description: 'Search the live web for real-time information, recent news, current events, and facts.',
  inputSchema: z.object({
    query: z.string().describe('The web search query')
  }),
  execute: async ({ query }) => {
    try {
      const encodedQuery = encodeURIComponent(query)
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(6000)
      })

      if (!res.ok) {
        return {
          query,
          sources: [],
          results: `No live search results available for query: "${query}"`
        }
      }

      const html = await res.text()
      const sources: Array<{ title: string, url: string }> = []
      const snippets: string[] = []

      // Match result links and titles
      const resultRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      const titleRegex = /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      
      // Extract main result titles & links
      const linkMatches = html.matchAll(/<h2[^>]*class="[^"]*result__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)
      
      for (const m of linkMatches) {
        if (sources.length >= 5) break
        let rawUrl = m[1] || ''
        const title = (m[2] || '').replace(/<[^>]+>/g, '').trim()
        
        // Handle DuckDuckGo redirect url
        if (rawUrl.includes('uddg=')) {
          try {
            const urlObj = new URL(rawUrl, 'https://duckduckgo.com')
            const decoded = urlObj.searchParams.get('uddg')
            if (decoded) rawUrl = decoded
          } catch {
            // keep raw
          }
        }
        
        if (rawUrl.startsWith('http') && title) {
          sources.push({ title, url: rawUrl })
        }
      }

      // Extract snippets
      const snippetMatches = html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)
      for (const s of snippetMatches) {
        if (snippets.length >= 5) break
        const text = (s[1] || '').replace(/<[^>]+>/g, '').trim()
        if (text) snippets.push(text)
      }

      return {
        query,
        sources,
        summary: snippets.join('\n\n') || `Found information relevant to ${query}`
      }
    } catch {
      return {
        query,
        sources: [],
        summary: `Searched for ${query}`
      }
    }
  }
})
