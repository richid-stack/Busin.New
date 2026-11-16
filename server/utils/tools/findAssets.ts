import { tool } from 'ai'
import { z } from 'zod'
import { safeFetch } from '../netSafety'
import type { SafeFetchResult } from '../netSafety'
import { withToolLimits } from './limits'

type Fetcher = (url: string, options: { maxBytes: number, timeoutMs: number, signal?: AbortSignal, headers?: Record<string, string> }) => Promise<SafeFetchResult>

const ICON_SETS = ['lucide', 'tabler', 'ph', 'heroicons', 'solar', 'iconoir', 'mingcute', 'carbon']

interface IconifyCollection { name?: string, license?: { title?: string, spdx?: string }, palette?: boolean }

const asJson = (res: SafeFetchResult): any => {
  if (res.status < 200 || res.status >= 300) throw new Error(`The service answered with status ${res.status}.`)
  try { return JSON.parse(res.body.toString('utf8')) } catch { throw new Error('The service sent something unreadable.') }
}

/**
 * Searches open icon libraries (through the public Iconify service) and says which licence each icon carries,
 * so the assistant can use an icon in a design and credit it when the licence asks for that.
 */
export function createFindIconsTool(userId: string, fetcher: Fetcher = safeFetch as Fetcher) {
  return tool({
    description: 'Search open-source icon libraries (Lucide, Tabler, Phosphor, Heroicons and more) for icons to use in a design. Returns icon names, a link to each SVG and its licence. Use it instead of drawing icons by hand. Pick one set for the whole design so the icons match, and name the set when you use one.',
    inputSchema: z.object({
      query: z.string().min(2).max(60).describe('What the icon shows, in one or two words: "calendar", "arrow right", "shield check"'),
      set: z.enum(ICON_SETS as [string, ...string[]]).optional().describe('Search only this icon set, so a whole design shares one style'),
      limit: z.number().int().min(4).max(24).default(12)
    }),
    execute: withToolLimits(
      { name: 'find_icons', userId, perMinute: 20, timeoutMs: 20_000, maxResultChars: 5_000 },
      async ({ query, set, limit }, signal) => {
        try {
          const params = new URLSearchParams({ query, limit: String(Math.max(32, limit)), prefixes: set ?? ICON_SETS.join(',') })
          const data = asJson(await fetcher(`https://api.iconify.design/search?${params}`, { maxBytes: 600_000, timeoutMs: 12_000, signal }))
          const names: string[] = (Array.isArray(data.icons) ? data.icons : []).filter((n: unknown) => typeof n === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/.test(n)).slice(0, limit)
          const collections: Record<string, IconifyCollection> = data.collections && typeof data.collections === 'object' ? data.collections : {}
          const icons = names.map((name) => {
            const [prefix, icon] = name.split(':') as [string, string]
            const c = collections[prefix]
            return { name, set: c?.name ?? prefix, licence: c?.license?.spdx || c?.license?.title || 'unknown', svg: `https://api.iconify.design/${prefix}/${icon}.svg` }
          })
          if (!icons.length) return { status: 'ok' as const, query, count: 0, icons: [], note: 'No icons matched. Try a simpler or more common word.' }
          return { status: 'ok' as const, query, count: icons.length, icons, note: 'Use the SVG link as an image source, or fetch_file it to keep a copy. Check the licence: MIT, Apache-2.0, ISC and CC0 need no credit in a product; CC-BY needs credit to the author.' }
        } catch (err: any) {
          return { status: 'failed' as const, query, error: `Icon search failed: ${err?.message || 'unknown error'}` }
        }
      }
    )
  })
}

interface FontsourceFont { id?: string, family?: string, category?: string, weights?: number[], styles?: string[], subsets?: string[], variable?: boolean }

let fontCache: { at: number, fonts: FontsourceFont[] } | null = null
const FONT_TTL_MS = 6 * 3_600_000

async function loadFonts(fetcher: Fetcher, signal?: AbortSignal): Promise<FontsourceFont[]> {
  if (fontCache && Date.now() - fontCache.at < FONT_TTL_MS) return fontCache.fonts
  const data = asJson(await fetcher('https://api.fontsource.org/v1/fonts', { maxBytes: 6_000_000, timeoutMs: 15_000, signal }))
  if (!Array.isArray(data)) throw new Error('The font list was unreadable.')
  fontCache = { at: Date.now(), fonts: data }
  return data
}

/** Test hook: forget the cached font list. */
export function resetFontCache() { fontCache = null }

/**
 * Searches open-source web fonts (the Fontsource catalogue, all freely licensed) by name or style, and says
 * how to load the font, so a design can use real type instead of a default.
 */
export function createFindFontsTool(userId: string, fetcher: Fetcher = safeFetch as Fetcher) {
  return tool({
    description: 'Search free, open-source web fonts (Google Fonts and others through Fontsource) by name or style. Returns the family, style category, weights, whether it is variable, and how to load it. Use it to choose real type for a design: one display or serif face for headlines and one clean sans for text is usually enough. Check that a font you want exists before putting it in a design.',
    inputSchema: z.object({
      query: z.string().max(60).optional().describe('Part of a font name, for example "inter" or "serif display". Leave out to browse by category.'),
      category: z.enum(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']).optional(),
      variable: z.boolean().optional().describe('Only fonts that are variable (one file, every weight)'),
      limit: z.number().int().min(3).max(20).default(10)
    }),
    execute: withToolLimits(
      { name: 'find_fonts', userId, perMinute: 20, timeoutMs: 25_000, maxResultChars: 5_000 },
      async ({ query, category, variable, limit }, signal) => {
        try {
          const all = await loadFonts(fetcher, signal)
          const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
          const scored = all
            .filter(f => f.id && f.family && (!category || f.category === category) && (variable === undefined || Boolean(f.variable) === variable))
            .map((f) => {
              const name = f.family!.toLowerCase()
              // Names that start with the search rank first, then names that contain it.
              const score = words.length === 0 ? 1 : words.every(w => name.includes(w)) ? (name.startsWith(words[0]!) ? 3 : 2) : 0
              return { f, score }
            })
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score || a.f.family!.localeCompare(b.f.family!))
            .slice(0, limit)
          const fonts = scored.map(({ f }) => ({
            family: f.family!,
            category: f.category ?? 'unknown',
            weights: (f.weights ?? []).slice(0, 12),
            variable: Boolean(f.variable),
            latin: (f.subsets ?? []).includes('latin'),
            load: `npm i @fontsource/${f.id}  then  import '@fontsource/${f.id}'   (or CSS: https://cdn.jsdelivr.net/npm/@fontsource/${f.id}/index.css)`
          }))
          return { status: 'ok' as const, query: query ?? category ?? '', count: fonts.length, fonts, note: 'All fonts listed are open-source (OFL or similar) and free for commercial use. Prefer at most two families in one design.' }
        } catch (err: any) {
          return { status: 'failed' as const, query: query ?? '', error: `Font search failed: ${err?.message || 'unknown error'}` }
        }
      }
    )
  })
}
