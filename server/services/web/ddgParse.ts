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
