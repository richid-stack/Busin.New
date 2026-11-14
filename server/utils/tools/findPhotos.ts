import { tool } from 'ai'
import { z } from 'zod'
import { safeFetch } from '../netSafety'
import type { SafeFetchResult } from '../netSafety'
import { withToolLimits } from './limits'

type Fetcher = (url: string, options: { maxBytes: number, timeoutMs: number, signal?: AbortSignal, headers?: Record<string, string> }) => Promise<SafeFetchResult>
type Env = Record<string, string | undefined>

export interface Photo {
  id: string
  source: 'Unsplash' | 'Pexels' | 'Pixabay'
  description: string
  photographer: string
  photographerUrl: string
  pageUrl: string
  /** A mid-size picture (about 1080 px wide) that fits the file limit, ready for fetch_file. */
  url: string
  width: number
  height: number
  licence: string
  credit: string
}

interface Provider {
  name: Photo['source']
  key: string
  search: (query: string, limit: number, orientation: string | undefined, key: string, fetcher: Fetcher, signal?: AbortSignal) => Promise<Photo[]>
}

const asJson = (res: SafeFetchResult): any => {
  if (res.status === 401 || res.status === 403) throw new Error('the key was refused or its hourly limit is used up')
  if (res.status < 200 || res.status >= 300) throw new Error(`the service answered with status ${res.status}`)
  try { return JSON.parse(res.body.toString('utf8')) } catch { throw new Error('the service sent something unreadable') }
}
const text = (v: unknown, max = 140) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const https = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.toString() : '' } catch { return '' } }

const UNSPLASH_LICENCE = 'Unsplash licence: free for commercial use, credit the photographer'
const PEXELS_LICENCE = 'Pexels licence: free for commercial use, credit is kind but not required'
const PIXABAY_LICENCE = 'Pixabay licence: free for commercial use, no credit needed'

export const PHOTO_PROVIDERS: Provider[] = [
  {
    name: 'Unsplash',
    key: 'UNSPLASH_ACCESS_KEY',
    search: async (query, limit, orientation, key, fetcher, signal) => {
      const params = new URLSearchParams({ query, per_page: String(limit), content_filter: 'high' })
      if (orientation) params.set('orientation', orientation)
      const data = asJson(await fetcher(`https://api.unsplash.com/search/photos?${params}`, { maxBytes: 400_000, timeoutMs: 12_000, signal, headers: { 'Authorization': `Client-ID ${key}`, 'Accept-Version': 'v1' } }))
      return (Array.isArray(data.results) ? data.results : []).map((p: any): Photo | null => {
        const url = https(p?.urls?.regular)
        if (!url || !p.id) return null
        const who = text(p.user?.name, 60) || 'Unknown'
        return {
          id: `unsplash:${p.id}`, source: 'Unsplash', description: text(p.alt_description || p.description) || 'Photo',
          photographer: who, photographerUrl: https(p.user?.links?.html), pageUrl: https(p.links?.html), url,
          width: Number(p.width) || 0, height: Number(p.height) || 0, licence: UNSPLASH_LICENCE, credit: `Photo by ${who} on Unsplash`
        }
      }).filter(Boolean) as Photo[]
    }
  },
  {
    name: 'Pexels',
    key: 'PEXELS_API_KEY',
    search: async (query, limit, orientation, key, fetcher, signal) => {
      const params = new URLSearchParams({ query, per_page: String(limit) })
      if (orientation) params.set('orientation', orientation)
      const data = asJson(await fetcher(`https://api.pexels.com/v1/search?${params}`, { maxBytes: 400_000, timeoutMs: 12_000, signal, headers: { Authorization: key } }))
      return (Array.isArray(data.photos) ? data.photos : []).map((p: any): Photo | null => {
        const url = https(p?.src?.large)
        if (!url || !p.id) return null
        const who = text(p.photographer, 60) || 'Unknown'
        return {
          id: `pexels:${p.id}`, source: 'Pexels', description: text(p.alt) || 'Photo',
          photographer: who, photographerUrl: https(p.photographer_url), pageUrl: https(p.url), url,
          width: Number(p.width) || 0, height: Number(p.height) || 0, licence: PEXELS_LICENCE, credit: `Photo by ${who} on Pexels`
        }
      }).filter(Boolean) as Photo[]
    }
  },
  {
    name: 'Pixabay',
    key: 'PIXABAY_API_KEY',
    search: async (query, limit, orientation, key, fetcher, signal) => {
      const params = new URLSearchParams({ key, q: query, per_page: String(Math.max(3, limit)), image_type: 'photo', safesearch: 'true' })
      if (orientation) params.set('orientation', orientation === 'landscape' ? 'horizontal' : orientation === 'portrait' ? 'vertical' : 'all')
      const data = asJson(await fetcher(`https://pixabay.com/api/?${params}`, { maxBytes: 400_000, timeoutMs: 12_000, signal }))
      return (Array.isArray(data.hits) ? data.hits : []).slice(0, limit).map((p: any): Photo | null => {
        const url = https(p?.webformatURL)
        if (!url || !p.id) return null
        const who = text(p.user, 60) || 'Unknown'
        return {
          id: `pixabay:${p.id}`, source: 'Pixabay', description: text(p.tags) || 'Photo',
          photographer: who, photographerUrl: p.user_id ? `https://pixabay.com/users/${encodeURIComponent(who)}-${p.user_id}/` : '', pageUrl: https(p.pageURL), url,
          width: Number(p.webformatWidth) || 0, height: Number(p.webformatHeight) || 0, licence: PIXABAY_LICENCE, credit: `Photo by ${who} on Pixabay`
        }
      }).filter(Boolean) as Photo[]
    }
  }
]

const PHOTO_RESULT_BUDGET = 4_800

/** Which photo services have a key set here. */
export const photoSourcesAvailable = (env: Env = process.env) => PHOTO_PROVIDERS.filter(p => env[p.key]?.trim()).map(p => p.name)

/**
 * Searches free stock photo libraries (Unsplash, Pexels, Pixabay, whichever have a key) and returns real photos with
 * their licence and credit. The first service with results answers, so a used-up hourly limit on one falls through to the next.
 */
export function createFindPhotosTool(userId: string, fetcher: Fetcher = safeFetch as Fetcher, env: Env = process.env) {
  return tool({
    description: 'Search free stock photo libraries (Unsplash, Pexels, Pixabay) for real photos to use in a page, document or deck. Returns each photo with its photographer, licence, credit line and a link sized to fit the file limit. Then call fetch_file with a photo\'s url to keep it, and view_image to look at it before you use it. Never invent a photo link, and never use a photo you have not found with this tool. Use the credit line where the licence asks for it.',
    inputSchema: z.object({
      query: z.string().min(2).max(80).describe('What the photo shows, in a few plain words: "team meeting in a bright office", "accra skyline at dusk"'),
      orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('landscape for banners and hero images, portrait for covers and phones'),
      limit: z.number().int().min(3).max(10).default(6),
      source: z.enum(['Unsplash', 'Pexels', 'Pixabay']).optional().describe('Only search this service. Leave out to use whichever is available.')
    }),
    execute: withToolLimits(
      { name: 'find_photos', userId, perMinute: 15, timeoutMs: 30_000, maxResultChars: 6_000 },
      async ({ query, orientation, limit, source }, signal) => {
        const usable = PHOTO_PROVIDERS.filter(p => env[p.key]?.trim() && (!source || p.name === source))
        if (!usable.length) {
          return { status: 'failed' as const, query, error: source ? `${source} is not set up here. Try another photo service, or ask the user for a photo.` : 'Photo search is not set up here yet, so there is nothing to search. Tell the user, and do not invent photo links.' }
        }
        const problems: string[] = []
        for (const p of usable) {
          try {
            const photos = await p.search(query, limit, orientation, env[p.key]!.trim(), fetcher, signal)
            if (photos.length) {
              // The result has a size budget. Drop whole photos to fit it; cutting inside a photo would break its links.
              const fit = [...photos]
              while (fit.length > 1 && JSON.stringify(fit).length > PHOTO_RESULT_BUDGET) fit.pop()
              return { status: 'ok' as const, query, count: fit.length, source: p.name, photos: fit, note: 'Save a photo with fetch_file using its url, and look at it with view_image before you use it. Put the credit line in the work where the licence asks for it (Unsplash does). Photos are real pictures: say what they show, not what you hoped they would show.' }
            }
            problems.push(`${p.name} had no matches`)
          } catch (err: any) {
            problems.push(`${p.name}: ${err?.message || 'failed'}`)
          }
        }
        const nothing = problems.every(m => /no matches/.test(m))
        return nothing
          ? { status: 'ok' as const, query, count: 0, photos: [], note: 'No photos matched. Try fewer or more common words.' }
          : { status: 'failed' as const, query, error: `Photo search failed (${problems.join('; ')}).` }
      }
    )
  })
}
