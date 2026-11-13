import { safeFetch } from '../../utils/netSafety'
import type { SafeFetchResult } from '../../utils/netSafety'

/**
 * Reads the design of a public web page from its own CSS: colours, fonts, sizes, corner radius and shadows,
 * ranked by how often the page uses them. It reads the stylesheets as written, so it shows what the page
 * says it uses, not what a browser computed. Pages that build their styles with JavaScript show less.
 */

export interface DesignTokens {
  url: string
  title: string
  themeColor: string | null
  /** Colours the page uses most, as hex, with how many times each appears. */
  colors: { hex: string, uses: number, role: 'neutral' | 'accent' }[]
  fonts: { family: string, uses: number }[]
  fontSizes: { value: string, uses: number }[]
  radii: { value: string, uses: number }[]
  shadows: string[]
  /** Named CSS variables such as --brand or --radius, the clearest signal of a design system. */
  variables: { name: string, value: string }[]
  stylesheets: number
  note: string
}

type Fetcher = (url: string, options: { maxBytes: number, timeoutMs: number, signal?: AbortSignal }) => Promise<SafeFetchResult>

const MAX_SHEETS = 6

/** True only when the address really is on Google Fonts, not when the text appears somewhere in a longer address. */
function isGoogleFontsUrl(href: string): boolean {
  try { return new URL(href).hostname === 'fonts.googleapis.com' } catch { return false }
}
const MAX_HTML = 1_500_000
const MAX_SHEET = 600_000

const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'arial', 'helvetica', 'apple color emoji', 'segoe ui emoji', 'noto color emoji'])

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** One CSS colour as lower-case #rrggbb, or null when it is not a plain colour (or is see-through). */
export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    const h = m[1]!
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && h[3] === '0') return null
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    }
    if (h.length === 6) return `#${h}`
    if (h.length === 8) return h.slice(6) === '00' ? null : `#${h.slice(0, 6)}`
    return null
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(v)
  if (m) {
    const ch = (n: string, pct: string) => pct ? parseFloat(n) * 2.55 : parseFloat(n)
    const alpha = m[7] === undefined ? 1 : (m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]))
    if (alpha < 0.05) return null
    return `#${hex2(ch(m[1]!, m[2]!))}${hex2(ch(m[3]!, m[4]!))}${hex2(ch(m[5]!, m[6]!))}`
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(v)
  if (m) {
    const alpha = m[4] === undefined ? 1 : (m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]))
    if (alpha < 0.05) return null
    const [r, g, b] = hslToRgb(parseFloat(m[1]!), parseFloat(m[2]!) / 100, parseFloat(m[3]!) / 100)
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`
  }
  return null
}

/** Greys, white and black carry no brand; anything with colour in it is an accent. */
export function colorRole(hex: string): 'neutral' | 'accent' {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255
  return Math.max(r, g, b) - Math.min(r, g, b) < 24 ? 'neutral' : 'accent'
}

const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by)
const top = (map: Map<string, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,60}\)|hsla?\([^)]{5,60}\)/g

export function analyzeCss(css: string) {
  const colors = new Map<string, number>()
  const fonts = new Map<string, number>()
  const sizes = new Map<string, number>()
  const radii = new Map<string, number>()
  const shadows = new Map<string, number>()
  const variables = new Map<string, string>()

  // Comments and url(...) payloads can hold colour-like text that is not a colour the page uses.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/gi, 'url()')

  for (const m of clean.matchAll(COLOR_RE)) {
    const hex = normalizeColor(m[0])
    if (hex) bump(colors, hex)
  }
  for (const m of clean.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = m[1]!.split(',')[0]!.replace(/!important/gi, '').replace(/['"]/g, '').trim()
    if (first && !first.startsWith('var(') && !GENERIC_FONTS.has(first.toLowerCase())) bump(fonts, first)
  }
  for (const m of clean.matchAll(/(?<![-\w])font-size\s*:\s*([\d.]+(?:px|rem|em))/gi)) bump(sizes, m[1]!.toLowerCase())
  for (const m of clean.matchAll(/(?<![-\w])border-radius\s*:\s*([^;}{]{1,30})/gi)) {
    const v = m[1]!.trim().toLowerCase()
    if (!v.includes('var(') && v !== '0' && v !== 'inherit') bump(radii, v)
  }
  for (const m of clean.matchAll(/(?<![-\w])box-shadow\s*:\s*([^;}{]{4,160})/gi)) {
    const v = m[1]!.trim()
    if (v !== 'none' && !v.includes('var(')) bump(shadows, v)
  }
  for (const m of clean.matchAll(/(--[a-z0-9-]{1,40})\s*:\s*([^;}{]{1,60})/gi)) {
    const name = m[1]!.toLowerCase()
    if (/^--(tw-|webkit|moz|ms-|vp-|swiper|bs-)/.test(name)) continue
    const value = m[2]!.trim()
    if (!variables.has(name) && (normalizeColor(value) || /^[\d.]+(px|rem|em)$/.test(value) || /font|radius|brand|primary|accent|color|bg|surface/.test(name))) variables.set(name, value)
  }
  return { colors, fonts, sizes, radii, shadows, variables }
}

function textOf(html: string, tag: RegExp): string {
  const m = tag.exec(html)
  return m ? m[1]!.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
}

/** Reads the page and up to six of its stylesheets, and ranks what they use. */
export async function readDesignTokens(url: string, deps: { fetcher?: Fetcher, signal?: AbortSignal } = {}): Promise<DesignTokens> {
  const fetcher = deps.fetcher ?? (safeFetch as Fetcher)
  const page = await fetcher(url, { maxBytes: MAX_HTML, timeoutMs: 12_000, signal: deps.signal })
  if (page.status < 200 || page.status >= 300) throw new Error(`The website answered with status ${page.status}.`)
  const html = page.body.toString('utf8')
  const base = new URL(page.url)

  const css: string[] = []
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css.push(m[1]!)

  const hrefs: string[] = []
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    try { hrefs.push(new URL(href.replace(/&amp;/g, '&'), base).href) } catch { /* skip a broken link */ }
  }
  // Google Fonts links name the families in the address itself.
  const googleFamilies: string[] = []
  for (const h of hrefs) {
    if (!isGoogleFontsUrl(h)) continue
    for (const f of new URL(h).searchParams.getAll('family')) googleFamilies.push(f.split(':')[0]!.replace(/\+/g, ' '))
  }

  let read = 0
  for (const href of hrefs.filter(h => !isGoogleFontsUrl(h)).slice(0, MAX_SHEETS)) {
    try {
      const sheet = await fetcher(href, { maxBytes: MAX_SHEET, timeoutMs: 8_000, signal: deps.signal })
      if (sheet.status >= 200 && sheet.status < 300) { css.push(sheet.body.toString('utf8')); read++ }
    } catch { /* a stylesheet that cannot be read is skipped, the rest still count */ }
  }

  const found = analyzeCss(css.join('\n'))
  for (const f of googleFamilies) found.fonts.set(f, (found.fonts.get(f) ?? 0) + 1)

  const theme = /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
  const colors = top(found.colors, 14).map(([hex, uses]) => ({ hex, uses, role: colorRole(hex) }))
  const total = css.join('').length + html.length
  return {
    url: page.url,
    title: textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    themeColor: theme ? normalizeColor(theme) : null,
    colors,
    fonts: top(found.fonts, 6).map(([family, uses]) => ({ family, uses })),
    fontSizes: top(found.sizes, 8).map(([value, uses]) => ({ value, uses })),
    radii: top(found.radii, 5).map(([value, uses]) => ({ value, uses })),
    shadows: top(found.shadows, 3).map(([v]) => v),
    variables: [...found.variables.entries()].slice(0, 24).map(([name, value]) => ({ name, value })),
    stylesheets: read,
    note: colors.length || found.fonts.size
      ? `Read from the page's own CSS (${read} stylesheet${read === 1 ? '' : 's'}), ranked by how often each value appears. It shows what the page declares, not what a browser computed.`
      : `Almost no CSS could be read (${Math.round(total / 1024)} KB looked at). The page probably builds its styles with JavaScript: use look_at_page to see it instead.`
  }
}
