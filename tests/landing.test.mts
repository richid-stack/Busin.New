import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const L = 'landing'
const html = readFileSync(`${L}/index.html`, 'utf8')
const size = (dir: string) => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)
const body = html.slice(html.indexOf('<body'))
const markup = body.replace(/<script[\s\S]*?<\/script>/g, '')
const script = (body.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''

// ---- The page keeps the approved design: the original stylesheet is still there, untouched ----
for (const rule of ['.vid{', '.mq{', '.card{', '.pf{', '.fq{', '.rc{', '.pk{', '.cm{', '.fin{', '#gw{', 'nav:after{']) assert(html.includes(rule), `original style rule ${rule} is present`)
assert(/font-family:Inter|font:400 15px\/1\.2 Inter/.test(html) && /--bl:#09f/.test(html), 'Inter and the #09f accent from the approved design are in use')
assert(!/linear-gradient\(135deg,#ff6b5e|#ff6b5e/i.test(html), 'no coral gradient from the rejected version')

// ---- Nothing points at a file that is not there ----
const refs = [...markup.matchAll(/(?:src|href|data-video|data-poster|poster)="([^"#]+)"/g)].map(m => m[1]!).filter(r => !/^(https?:|mailto:|\/\/)/.test(r))
const tiles = [...script.matchAll(/\['((?:crops|shots)\/[a-z0-9-]+)',\d+,/g)].map(m => `media/${m[1]}.webp`)
const tourClips = [...script.matchAll(/'(feature-[a-z-]+)'/g)].flatMap(m => [`media/video/${m[1]}.mp4`, `media/video/${m[1]}.webp`])
const logoNames = [...new Set([...script.matchAll(/assets\/logos\/([a-z0-9-]+)\.svg/g)].map(m => m[1]!).concat([...script.matchAll(/\['([a-z0-9-]+)','[A-Z][^']*'\]/g)].map(m => m[1]!), [...(script.match(/\['openai','claude-color'[^\]]*\]/)?.[0].matchAll(/'([a-z0-9-]+)'/g) ?? [])].map(m => m[1]!)))].map(n => `assets/logos/${n}.svg`)
const all = [...new Set([...refs, ...tiles, ...logoNames, ...tourClips, 'assets/logo.svg', 'site.config.js'])]
const missing = all.filter(r => !existsSync(join(L, r)))
assert(all.length > 60 && logoNames.length >= 40, `the page references its media (${all.length} files, ${logoNames.length} logos)`)
assert(missing.length === 0, `every local file the page uses exists (${missing.join(', ') || 'none missing'})`)

// ---- In-page links land somewhere ----
const idsInPage = new Set([...markup.matchAll(/id="([^"]+)"/g)].map(m => m[1]!))
const anchors = [...new Set([...markup.matchAll(/<a\b[^>]*href="#([^"]+)"/g)].map(m => m[1]!).concat([...script.matchAll(/'#([a-z]{2,6})'/g)].map(m => m[1]!).filter(a => !/^[a-f]+$/.test(a))))]
const bad = anchors.filter(a => !idsInPage.has(a))
assert(bad.length === 0, `every #link has a matching section (${bad.join(', ') || anchors.length + ' links'})`)

// ---- Accessible and light ----
const imgs = [...markup.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
assert(imgs.every(i => /\balt="/.test(i)), 'every image has an alt attribute')
assert(imgs.every(i => /\bwidth="\d+"/.test(i) && /\bheight="\d+"/.test(i)), 'every image has a width and height (no layout jump)')
assert(imgs.filter(i => /media\/(shots|crops)\//.test(i)).every(i => /loading="lazy"/.test(i)), 'screenshots load lazily')
assert([...markup.matchAll(/<video\b[^>]*>/g)].filter(v => !/id="vp"/.test(v[0])).every(v => /preload="(none|metadata)"/.test(v[0])), 'videos do not download until needed (the dialog player loads on click)')
assert([...markup.matchAll(/<video\b[^>]*>/g)].filter(v => !/id="(vp|tv)"/.test(v[0])).every(v => /poster=/.test(v[0])), 'page videos have a poster')
assert([...markup.matchAll(/data-video="[^"]+"/g)].length === [...markup.matchAll(/data-title="[^"]+"/g)].length, 'every video button has a title')
assert(/prefers-reduced-motion:reduce/.test(html) && /reduced-motion:reduce/.test(script), 'reduced motion is respected (styles and the videos)')
assert(/<html lang="en">/.test(html) && /name="viewport"/.test(html) && /name="description"/.test(html) && /og:image/.test(html), 'language, viewport, description and share image are set')

// ---- Honest copy: no prices, no licence named, nothing the app does not do ----
const text = (markup + script).replace(/<[^>]+>/g, ' ')
assert(!/[$€£]\s?\d|GH[₵S]\s?\d|\b\d+\s?(USD|GHS)\b/.test(text), 'no prices are stated (they are set elsewhere)')
assert(!/\b(MIT|Apache|GPL|AGPL|BSD)\b/.test(text), 'no licence is named (it is decided later)')
assert(/Docker setup is planned/.test(text) && !/one-command docker (is|works)/i.test(text), 'Docker is described as planned, not available')
assert(/Early/.test(text) && /not yet run on a live one/.test(text), 'the Reef and the Bridge are marked early, with the real caveat')
assert(/sample account/.test(text) && /illustrated from the README steps and are not screen recordings/.test(text), 'the footage and the tutorials are disclosed (sample account, illustrated)')
for (const word of ['Gmail', 'Slack', 'GitHub', 'Notion', 'Google Calendar', 'Google Drive', 'MCP']) assert(text.includes(word), `${word} is named (it is in the app)`)
for (const gone of ['Vercel', 'Telegram', 'Blender', 'FL Studio', 'catalog', 'Catalog', 'Capability Search', 'benchmark', 'Benchmark', 'All services online']) assert(!text.includes(gone), `${gone} is not claimed (the app does not have it)`)

// ---- The links come from one config file ----
const cfg = readFileSync(`${L}/site.config.js`, 'utf8')
assert(/appUrl:/.test(cfg) && /github:/.test(cfg), 'the app and repository addresses live in site.config.js')
assert(!/href="https?:\/\/(?!fonts\.|github\.com\/richid-stack\/Busin\.New)/.test(markup), 'no stray external links in the page')

// ---- Weight: the site stays small enough to host anywhere ----
const vids = readdirSync(`${L}/media/video`).filter(f => f.endsWith('.mp4'))
assert(vids.length === 10 && vids.every(f => statSync(`${L}/media/video/${f}`).size < 4_000_000), `ten web videos, each under 4 MB (${vids.length})`)
assert(size(`${L}/media/video`) < 15_000_000, 'all videos and posters together are under 15 MB')
assert(size(`${L}/media/shots`) < 6_000_000, 'all screenshots together are under 6 MB')
assert(size(`${L}/media/crops`) < 1_500_000, 'all close-ups together are under 1.5 MB')
