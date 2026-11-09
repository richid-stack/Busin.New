// Builds src/generated/icons.json: only the icons this app (and Nuxt UI's own components) uses,
// so they ship with the bundle instead of being fetched from the Iconify CDN at runtime.
// Run `npm run icons` after adding an icon with a new name; it is idempotent.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PREFIXES = ['simple-icons', 'lucide', 'logos']
const ROOTS = ['src', 'server', 'index.html', 'node_modules/@nuxt/ui/dist']
const EXT = new Set(['.vue', '.ts', '.js', '.mjs', '.html', '.json'])

function* walk(path) {
  const st = statSync(path, { throwIfNoEntry: false })
  if (!st) return
  if (st.isFile()) { yield path; return }
  for (const name of readdirSync(path)) {
    if (name === 'generated' || name === 'node_modules') continue
    yield* walk(join(path, name))
  }
}

const used = Object.fromEntries(PREFIXES.map(p => [p, new Set()]))
const re = /\bi-(simple-icons|lucide|logos)[-:]([a-z0-9]+(?:-[a-z0-9]+)*)/g
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!EXT.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) used[m[1]].add(m[2])
  }
}

const collections = []
for (const prefix of PREFIXES) {
  const data = JSON.parse(readFileSync(require.resolve(`@iconify-json/${prefix}/icons.json`), 'utf8'))
  const icons = {}
  const aliases = {}
  for (const name of [...used[prefix]].sort()) {
    if (data.icons[name]) icons[name] = data.icons[name]
    else if (data.aliases?.[name]) {
      aliases[name] = data.aliases[name]
      const parent = data.aliases[name].parent
      if (data.icons[parent]) icons[parent] = data.icons[parent]
    }
    // Names that match nothing (e.g. partial strings in docs) are simply skipped.
  }
  collections.push({ prefix, icons, aliases, width: data.width, height: data.height })
}

// Brand logos (src/assets/brands/*.svg) are bundled whole as the "brand" collection, so `i-brand-github` just works.
// Most come from the LobeHub icon set (MIT); Context7's comes from its own repository.
{
  const dir = 'src/assets/brands'
  const icons = {}
  for (const file of readdirSync(dir).filter(f => f.endsWith('.svg')).sort()) {
    const svg = readFileSync(join(dir, file), 'utf8').trim()
    const root = svg.match(/^<svg([^>]*)>/)?.[1] ?? ''
    const box = root.match(/viewBox="([\d.\s-]+)"/)?.[1]?.trim().split(/\s+/).map(Number)
    if (!box || box.length !== 4) throw new Error(`${file} has no viewBox`)
    let body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[^<]*<\/title>/g, '')
    const carried = ['fill', 'fill-rule'].map(a => root.match(new RegExp(`\\s${a}="([^"]+)"`))?.[1] ? `${a}="${root.match(new RegExp(`\\s${a}="([^"]+)"`))[1]}"` : '').filter(Boolean).join(' ')
    if (carried) body = `<g ${carried}>${body}</g>`
    icons[file.replace(/\.svg$/, '')] = { body, left: box[0], top: box[1], width: box[2], height: box[3] }
  }
  collections.push({ prefix: 'brand', icons, aliases: {}, width: 24, height: 24 })
}

mkdirSync('src/generated', { recursive: true })
writeFileSync('src/generated/icons.json', JSON.stringify(collections))
console.log(collections.map(c => `${c.prefix}: ${Object.keys(c.icons).length}`).join(', '))
