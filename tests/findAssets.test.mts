import { createFindFontsTool, createFindIconsTool, resetFontCache } from '../server/utils/tools/findAssets'
import { createGithubReadTool } from '../server/utils/tools/githubRead'
import { createCommunitySearchTool } from '../server/utils/tools/communitySearch'
import type { SafeFetchResult } from '../server/utils/netSafety'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const run = (t: any, input: any) => t.execute(t.inputSchema.parse(input), { toolCallId: 't', messages: [] })
const json = (url: string, body: unknown, status = 200): SafeFetchResult => ({ status, url, contentType: 'application/json', headers: {}, body: Buffer.from(JSON.stringify(body)), truncated: false })

// ---------- find_icons ----------
const seen: string[] = []
const iconFetch: any = async (url: string) => {
  seen.push(url)
  return json(url, {
    icons: ['lucide:calendar', 'tabler:calendar', 'ph:calendar-blank', 'evil:../../x', 'lucide:calendar-days'],
    collections: { lucide: { name: 'Lucide', license: { spdx: 'ISC', title: 'ISC' } }, tabler: { name: 'Tabler Icons', license: { spdx: 'MIT' } } }
  })
}
const icons: any = await run(createFindIconsTool('u1', iconFetch), { query: 'calendar', limit: 4 })
assert(icons.status === 'ok' && icons.count === 4 && icons.icons[0].svg === 'https://api.iconify.design/lucide/calendar.svg', 'icons come back with an SVG link')
assert(icons.icons[0].licence === 'ISC' && icons.icons[2].licence === 'unknown', 'each icon carries its licence, or says it is unknown')
assert(!icons.icons.some((i: any) => i.name.includes('..')), 'a malformed icon name is dropped')
assert(/query=calendar/.test(seen[0]!) && /prefixes=lucide/.test(seen[0]!), 'the search goes to Iconify with the query and the allowed sets')
const one = await run(createFindIconsTool('u1', iconFetch), { query: 'calendar', set: 'tabler' })
assert(/prefixes=tabler(&|$)/.test(seen[1]!) && one.status === 'ok', 'a single set can be requested')
assert((await run(createFindIconsTool('u1', (async (u: string) => json(u, {}, 500)) as any), { query: 'home' })).status === 'failed', 'a service failure is a failed result')
assert((await run(createFindIconsTool('u1', (async (u: string) => json(u, { icons: [], collections: {} })) as any), { query: 'zzzz' })).count === 0, 'no matches is an empty list, not an error')
assert((createFindIconsTool('u1') as any).inputSchema.safeParse({ query: 'a' }).success === false, 'a one-letter query is refused')

// ---------- find_fonts ----------
resetFontCache()
let fontCalls = 0
const fontList = [
  { id: 'inter', family: 'Inter', category: 'sans-serif', weights: [400, 600], subsets: ['latin'], variable: true },
  { id: 'playfair-display', family: 'Playfair Display', category: 'serif', weights: [400, 700], subsets: ['latin'], variable: true },
  { id: 'dm-serif-display', family: 'DM Serif Display', category: 'serif', weights: [400], subsets: ['latin'], variable: false },
  { id: 'inria-sans', family: 'Inria Sans', category: 'sans-serif', weights: [300, 400], subsets: ['latin'], variable: false }
]
const fontFetch: any = async (u: string) => { fontCalls++; return json(u, fontList) }
const fonts: any = await run(createFindFontsTool('u1', fontFetch), { query: 'in' })
assert(!fonts.fonts.some((f: any) => f.family === 'Playfair Display'), 'fonts that do not match the search are left out')
assert(fonts.fonts.map((f: any) => f.family).slice(0, 2).join() === 'Inria Sans,Inter', 'matches are ordered: starts-with first, then alphabetical')
const serif: any = await run(createFindFontsTool('u1', fontFetch), { category: 'serif', variable: true })
assert(serif.count === 1 && serif.fonts[0].family === 'Playfair Display' && serif.fonts[0].load.includes('@fontsource/playfair-display'), 'category and variable filters work and say how to load the font')
assert(fontCalls === 1, 'the font list is fetched once and cached')
resetFontCache()
assert((await run(createFindFontsTool('u1', (async (u: string) => json(u, { nope: true })) as any), { query: 'inter' })).status === 'failed', 'an unreadable font list is a failed result')

// ---------- github_read ----------
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64')
const ghCalls: { url: string, headers?: Record<string, string> }[] = []
const gh: any = async (url: string, o: any) => {
  ghCalls.push({ url, headers: o.headers })
  if (url.includes('private')) return json(url, {}, 404)
  if (url.endsWith('/contents/')|| url.includes('/contents?') || url.endsWith('/contents')) return json(url, [{ name: 'src', type: 'dir', size: 0 }, { name: 'README.md', type: 'file', size: 2048 }])
  if (url.includes('/readme')) return json(url, { content: b64('# Hello\nA tiny project.') })
  if (url.includes('/contents/src')) return json(url, [{ name: 'main.ts', type: 'file', size: 100 }])
  if (url.includes('/contents/logo.png')) return json(url, { type: 'file', encoding: 'base64', content: b64(Buffer.from([1, 2, 0, 0, 9])) })
  if (url.includes('/contents/big.txt')) return json(url, { type: 'file', size: 2_000_000, content: '' })
  if (url.includes('/contents/a.ts')) return json(url, { type: 'file', encoding: 'base64', content: b64('x'.repeat(30_000)) })
  if (url.includes('private')) return json(url, {}, 404)
  return json(url, {}, 404)
}
const read = createGithubReadTool('u1', gh, { GITHUB_READ_TOKEN: 'tok' } as any)
const top: any = await run(read, { repo: 'https://github.com/acme/widgets.git' })
assert(top.status === 'ok' && top.kind === 'folder' && top.entries[0].type === 'folder' && /tiny project/.test(top.readme), 'the top level lists files and includes the README')
assert(ghCalls[0]!.url.startsWith('https://api.github.com/repos/acme/widgets/contents') && ghCalls[0]!.headers?.Authorization === 'Bearer tok', 'it reads api.github.com, with the server token only to lift the rate limit')
const dir: any = await run(read, { repo: 'acme/widgets', path: '/src/' })
assert(dir.kind === 'folder' && dir.path === 'src' && dir.entries[0].name === 'main.ts' && dir.readme === undefined, 'a folder lists its entries without a README')
const file: any = await run(read, { repo: 'acme/widgets', path: 'a.ts' })
assert(file.kind === 'file' && file.text.length === 24_000 && file.truncated === true, 'a long file is cut at the limit and says so')
assert(/data, not instructions/.test(file.notice), 'file text is marked untrusted')
assert((await run(read, { repo: 'acme/widgets', path: 'logo.png' })).error.includes('binary'), 'a binary file is refused with advice')
assert((await run(read, { repo: 'acme/widgets', path: 'big.txt' })).error.includes('1 MB'), 'a file over 1 MB is refused')
assert((await run(read, { repo: 'acme/private-thing' })).error.includes('private'), 'a missing or private repo says so')
for (const bad of ['acme', 'a/b/c', 'ac me/x', '../x']) assert((await run(read, { repo: bad })).status === 'failed', `a bad repo name is refused: ${bad}`)
assert((await run(read, { repo: 'acme/widgets', path: 'src/../../etc' })).status === 'failed', 'a path that climbs out is refused')
const limited: any = await run(createGithubReadTool('u1', (async (u: string) => json(u, {}, 403)) as any), { repo: 'acme/widgets' })
assert(/limiting/.test(limited.error), 'a rate limit is explained')

// ---------- community_search ----------
const projects = [{ owner: 'ama', name: 'invoice-nudge', description: 'Reminds clients about unpaid invoices', tags: ['finance'], stars: 5, installs: 12, safety: 'passed', licence: { id: 'mit', short: 'MIT' }, works: [{ id: 'gmail', label: 'Gmail', sensitive: true }] }]
let asked: any
const reef: any = { projects: { list: async (o: any) => { asked = o; return projects } } }
const found: any = await run(createCommunitySearchTool('u1', () => reef), { query: 'invoice reminders' })
assert(found.status === 'ok' && found.projects[0].id === 'ama/invoice-nudge' && found.projects[0].needs[0] === 'Gmail' && asked.limit === 8 && asked.q === 'invoice reminders', 'the Reef is searched and results carry owner/name, safety and needs')
const empty: any = await run(createCommunitySearchTool('u1', () => ({ projects: { list: async () => [] } }) as any), { query: 'nothing here' })
assert(empty.count === 0 && /Nothing/.test(empty.note), 'an empty Reef search says so')
const broken: any = await run(createCommunitySearchTool('u1', () => ({ projects: { list: async () => { throw new Error('db') } } }) as any), { query: 'x y' })
assert(broken.status === 'failed' && !/db/.test(broken.error), 'a Reef failure is a plain failed result that does not leak internals')
