/**
 * Rules for the web pages OpenLobs makes. A page is one self-contained HTML file: its own styles, its own small
 * scripts if it needs them, pictures drawn as inline SVG or CSS. It cannot load anything from the internet, so it
 * opens the same everywhere and a preview can never reach out of the sandbox.
 *
 * These checks are guard rails that give the assistant a clear, plain reason to fix a page. The real protection is
 * the sandbox and the content policy the preview runs under (see src/utils/pagePreview.ts).
 */
export const PAGE_MAX_CHARS = 200_000

const BLOCKED: { test: RegExp, why: string }[] = [
  { test: /<script\b[^>]*\bsrc\s*=/i, why: 'it loads a script from a file or address (put the script inside the page)' },
  { test: /<link\b(?![^>]*\bhref\s*=\s*["']?data:)/i, why: 'it links to another file (put styles inside a <style> tag)' },
  { test: /<(iframe|frame|frameset|object|embed|base)\b/i, why: 'it uses an embedded frame, object or base address' },
  { test: /http-equiv\s*=\s*["']?(refresh|set-cookie)/i, why: 'it redirects the page' },
  { test: /@import\b/i, why: 'it imports another stylesheet' },
  { test: /url\(\s*["']?\s*(https?:)?\/\//i, why: 'a style loads something from the internet (use a gradient, an inline SVG or a data: picture)' },
  { test: /\b(src|srcset|poster|data)\s*=\s*["']?\s*(https?:)?\/\//i, why: 'a picture, video or file is loaded from the internet (draw it as inline SVG or CSS instead)' },
  { test: /<form\b[^>]*\baction\s*=\s*["']?\s*(https?:)?\/\//i, why: 'a form sends data to another address' },
  { test: /javascript\s*:/i, why: 'a link runs script from its address' },
  { test: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(/, why: 'a script talks to the internet' },
  { test: /\b(window|document|top|parent|self)\s*\.\s*(location|open)\b|\blocation\s*(=|\.\s*(href|assign|replace))|\bwindow\s*\.\s*open\s*\(/, why: 'a script moves away from the page or opens another window' }
]

/** Returns a plain reason when the page breaks the rules, or null when it is fine. */
export function pageProblem(html: string): string | null {
  if (!html.trim()) return 'The page is empty.'
  if (html.length > PAGE_MAX_CHARS) return `The page is ${Math.round(html.length / 1000)}K characters long, over the ${Math.round(PAGE_MAX_CHARS / 1000)}K limit. Make it shorter.`
  if (!/<[a-z!][^>]*>/i.test(html)) return 'This does not look like a web page. Write it as HTML.'
  for (const rule of BLOCKED) if (rule.test.test(html)) return `Pages here cannot load anything from outside or move away: ${rule.why}.`
  return null
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Makes sure what is saved is a whole page: a bare piece of HTML is wrapped so it works on a phone and has a title. */
export function completePage(html: string, title: string): string {
  const source = html.trim()
  if (/<html[\s>]/i.test(source)) return /^\s*<!doctype/i.test(source) ? source : `<!doctype html>\n${source}`
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeText(title)}</title>\n</head>\n<body>\n${source}\n</body>\n</html>`
}

/** The headings of a page, for the numbered outline the assistant sees. */
export function pageHeadings(html: string, limit = 30): string[] {
  const out: string[] = []
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  for (let m = re.exec(html); m && out.length < limit; m = re.exec(html)) {
    const text = m[2]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text) out.push(`${'  '.repeat(Number(m[1]) - 1)}${text.length > 70 ? `${text.slice(0, 69)}…` : text}`)
  }
  return out
}
