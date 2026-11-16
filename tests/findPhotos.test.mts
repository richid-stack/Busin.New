import { createFindPhotosTool, photoSourcesAvailable } from '../server/utils/tools/findPhotos'
import { getLookupTrace } from '../src/utils/tool'
import { fetchGuidance } from '../server/services/design/guidance'
import type { SafeFetchResult } from '../server/utils/netSafety'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const run = (t: any, input: any) => t.execute(t.inputSchema.parse(input), { toolCallId: 't', messages: [] })
const json = (url: string, body: unknown, status = 200): SafeFetchResult => ({ status, url, contentType: 'application/json', headers: {}, body: Buffer.from(JSON.stringify(body)), truncated: false })

const unsplash = { results: [
  { id: 'u1', alt_description: 'a calm skyline at dusk', width: 4000, height: 2600, urls: { regular: 'https://images.unsplash.com/photo-1?w=1080' }, links: { html: 'https://unsplash.com/photos/u1' }, user: { name: 'Ama Boateng', links: { html: 'https://unsplash.com/@ama' } } },
  { id: 'bad', alt_description: 'no usable link', urls: { regular: 'javascript:alert(1)' }, user: { name: 'X' } },
  { id: 'u2', description: 'market stalls', width: 3000, height: 2000, urls: { regular: 'https://images.unsplash.com/photo-2?w=1080' }, links: { html: 'https://unsplash.com/photos/u2' }, user: { name: 'Kofi' } }
] }
const pexels = { photos: [{ id: 7, alt: 'laptop on a desk', width: 5000, height: 3000, photographer: 'Efua', photographer_url: 'https://www.pexels.com/@efua', url: 'https://www.pexels.com/photo/7/', src: { large: 'https://images.pexels.com/photos/7/large.jpeg' } }] }
const pixabay = { hits: [{ id: 9, tags: 'beach, sea', user: 'Yaw', user_id: 5, pageURL: 'https://pixabay.com/photos/9/', webformatURL: 'https://pixabay.com/get/9_640.jpg', webformatWidth: 640, webformatHeight: 427 }] }

const calls: { url: string, headers?: Record<string, string> }[] = []
const happy: any = async (url: string, o: any) => {
  calls.push({ url, headers: o.headers })
  if (url.includes('unsplash')) return json(url, unsplash)
  if (url.includes('pexels')) return json(url, pexels)
  return json(url, pixabay)
}
const all = { UNSPLASH_ACCESS_KEY: ' uk ', PEXELS_API_KEY: 'pk', PIXABAY_API_KEY: 'xk' }

const a: any = await run(createFindPhotosTool('u1', happy, all), { query: 'skyline', orientation: 'landscape', limit: 6 })
assert(a.status === 'ok' && a.source === 'Unsplash' && a.count === 2, 'the first service with a key answers, and a photo with an unsafe link is dropped')
assert(a.photos[0].credit === 'Photo by Ama Boateng on Unsplash' && /credit the photographer/.test(a.photos[0].licence), 'each photo carries its credit line and licence')
assert(a.photos[0].url.startsWith('https://') && a.photos[1].description === 'market stalls', 'links are https and descriptions fall back to the plain description')
assert(calls[0]!.headers?.Authorization === 'Client-ID uk' && /orientation=landscape/.test(calls[0]!.url) && /query=skyline/.test(calls[0]!.url), 'Unsplash is called with the key (trimmed), the query and the orientation')
assert(calls.length === 1, 'only one service is called when the first one has results')

const pOnly: any = await run(createFindPhotosTool('u1', happy, { PEXELS_API_KEY: 'pk' }), { query: 'laptop' })
assert(pOnly.source === 'Pexels' && pOnly.photos[0].id === 'pexels:7' && calls.at(-1)!.headers?.Authorization === 'pk', 'with only a Pexels key, Pexels answers')

const limited: any = async (url: string, o: any) => url.includes('unsplash') ? json(url, {}, 403) : happy(url, o)
const fell: any = await run(createFindPhotosTool('u1', limited, all), { query: 'skyline' })
assert(fell.status === 'ok' && fell.source === 'Pexels', 'a refused or used-up key falls through to the next service')

const empty: any = async (url: string, o: any) => url.includes('unsplash') ? json(url, { results: [] }) : happy(url, o)
assert((await run(createFindPhotosTool('u1', empty, all), { query: 'zzz' })).source === 'Pexels', 'no matches also falls through')
const none: any = async (url: string) => json(url, { results: [], photos: [], hits: [] })
const noneRes: any = await run(createFindPhotosTool('u1', none, all), { query: 'zzz' })
assert(noneRes.status === 'ok' && noneRes.count === 0, 'no matches anywhere is an empty list, not an error')
const down: any = async (url: string) => json(url, {}, 500)
const downRes: any = await run(createFindPhotosTool('u1', down, all), { query: 'skyline' })
assert(downRes.status === 'failed' && /Unsplash/.test(downRes.error) && !/uk|pk|xk/.test(downRes.error.replace(/Unsplash|Pexels|Pixabay|photo|unreadable|status|answered|search|failed/gi, '')), 'every service failing is a failed result that names the services, never a key')
const px: any = await run(createFindPhotosTool('u1', happy, all), { query: 'beach', source: 'Pixabay' })
assert(px.source === 'Pixabay' && px.photos[0].photographerUrl.includes('/users/Yaw-5/') && /key=xk/.test(calls.at(-1)!.url), 'a service can be chosen')

const unset: any = await run(createFindPhotosTool('u1', happy, {}), { query: 'skyline' })
assert(unset.status === 'failed' && /not set up/.test(unset.error) && /do not invent/.test(unset.error), 'with no keys it says so and tells the model not to invent links')
assert((await run(createFindPhotosTool('u1', happy, { PEXELS_API_KEY: 'pk' }), { query: 'x y', source: 'Unsplash' })).status === 'failed', 'asking for a service without a key fails plainly')
assert(photoSourcesAvailable({ PEXELS_API_KEY: ' k ' }).join() === 'Pexels' && photoSourcesAvailable({}).length === 0, 'the available services follow the keys')
assert((createFindPhotosTool('u1') as any).inputSchema.safeParse({ query: 'a' }).success === false, 'a one-letter query is refused')

const trace = getLookupTrace({ input: { query: 'skyline' }, output: a } as any)
assert(trace.count === 2 && trace.lines[0] === 'a calm skyline at dusk · Ama Boateng · Unsplash' && trace.query === 'skyline', 'the trace lists each photo with its photographer and service')
assert(/find_photos/.test(fetchGuidance(['find_photos'])) && /credit/.test(fetchGuidance(['find_photos'])) && !/PHOTOS/.test(fetchGuidance(['find_icons'])), 'photo guidance appears only when the tool is there')
