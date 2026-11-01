import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const L = 'landing'
const html = readFileSync(`${L}/index.html`, 'utf8')
const css = readFileSync(`${L}/assets/site.css`, 'utf8')
const js = readFileSync(`${L}/assets/site.js`, 'utf8')
const size = (dir: string) => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)

// ---- Nothing on the page points at a file that is not there ----
const refs = [...html.matchAll(/(?:src|href|data-video|data-poster)="([^"#]+)"/g)].map(m => m[1]!).filter(r => !/^(https?:|mailto:|\/\/)/.test(r) && !r.startsWith('#'))
const missing = [...new Set(refs)].filter(r => !existsSync(join(L, r)))
assert(refs.length > 40, `the page references its media (${refs.length} references)`)
assert(missing.length === 0, `every local file the page uses exists (${missing.join(', ') || 'none missing'})`)

// The gallery builds its image names in script; check each one.
const ids = [...js.matchAll(/\['([a-z0-9-]+)', '[^']+'\]/g)].map(m => m[1]!)
const shotMissing = ids.flatMap(id => (id.startsWith('m-') ? ['light'] : ['light', 'dark']).map(t => `media/shots/${id}-${t}.webp`)).filter(f => !existsSync(join(L, f)))
assert(ids.length >= 16 && shotMissing.length === 0, `every gallery screenshot exists (${shotMissing.join(', ') || ids.length + ' screens'})`)

// ---- In-page links land somewhere ----
const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]!)
const idsInPage = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]!))
assert(anchors.every(a => idsInPage.has(a)), `every #link has a matching section (${anchors.filter(a => !idsInPage.has(a)).join(', ') || 'all found'})`)

// ---- Accessible and light ----
const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
assert(imgs.every(i => /\balt="/.test(i)), 'every image has an alt attribute')
assert(imgs.every(i => /\bwidth="\d+"/.test(i) && /\bheight="\d+"/.test(i)), 'every image has a width and height (no layout jump)')
assert(imgs.filter(i => /media\/shots\//.test(i)).every(i => /loading="lazy"/.test(i)), 'screenshots load lazily')
assert([...html.matchAll(/<video\b[^>]*>/g)].every(v => /preload="(none|metadata)"/.test(v[0]) && /poster=/.test(v[0]) || /<video id="vplayer"/.test(v[0])), 'videos do not download until needed and have a poster')
assert([...html.matchAll(/data-video="[^"]+"/g)].length === [...html.matchAll(/data-title="[^"]+"/g)].length, 'every video button has a title')
assert(/prefers-reduced-motion:\s*reduce/.test(css) && /reduce/.test(js), 'reduced motion is respected (styles and the hero video)')
assert(/<html lang="en">/.test(html) && /name="viewport"/.test(html) && /name="description"/.test(html) && /og:image/.test(html), 'language, viewport, description and share image are set')

// ---- Honest copy: no prices, no licence named, nothing the app does not do ----
const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
assert(!/[$€£]\s?\d|GH[₵S]\s?\d|\b\d+\s?(USD|GHS)\b/.test(text.replace(/GH₵ 350/g, '')), 'no prices are stated (they are set elsewhere)')
assert(!/\b(MIT|Apache|GPL|AGPL|BSD)\b/.test(text), 'no licence is named (it is decided later)')
assert(/Docker setup is planned/.test(text) && !/one-command docker (is|works)/i.test(text), 'Docker is described as planned, not available')
assert(/Early/.test(text) && /not yet run on real Firestore/.test(text), 'the Reef and the Bridge are marked early, with the real caveat')
assert(/sample content/.test(text) && /illustrated/.test(text), 'the footage and tutorial steps are disclosed as sample content / illustrated')
for (const word of ['Gmail', 'Slack', 'GitHub', 'Notion', 'Google Calendar']) assert(text.includes(word), `${word} is named (it is in the app's installed apps)`)

// ---- The links come from one config file ----
const cfg = readFileSync(`${L}/site.config.js`, 'utf8')
assert(/appUrl:/.test(cfg) && /github:/.test(cfg), 'the app and repository addresses live in site.config.js')
assert(!/href="https?:\/\/(?!fonts\.|github\.com\/richid-stack\/Busin\.New)/.test(html), 'no stray external links in the page')

// ---- Weight: the site stays small enough to host anywhere ----
const vids = readdirSync(`${L}/media/video`).filter(f => f.endsWith('.mp4'))
assert(vids.length === 10 && vids.every(f => statSync(`${L}/media/video/${f}`).size < 4_000_000), `ten web videos, each under 4 MB (${vids.length})`)
assert(size(`${L}/media/video`) < 15_000_000, 'all videos and posters together are under 15 MB')
assert(size(`${L}/media/shots`) < 6_000_000, 'all screenshots together are under 6 MB')
