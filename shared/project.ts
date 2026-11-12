import { isSecretFile } from './runPlan'

/**
 * A project is a folder of plain-text files the assistant builds up over a chat. The files live in OpenLobs, so reading,
 * searching and changing them is instant. These are the rules every file in a project goes through.
 *
 * The totals are small on purpose: one version of a project is kept as a single record, and a record is limited to about
 * 1 MB. About 600 thousand characters of code is far more than most small apps need.
 */
export const PROJECT_LIMITS = {
  files: 200,
  fileChars: 100_000,
  totalChars: 600_000,
  pathChars: 200
} as const

export interface ProjectFile { path: string, content: string }

export class ProjectError extends Error {}

/** A file name inside the project, tidied up. Throws a plain-words error when it is not allowed. */
export function cleanPath(input: string): string {
  const raw = String(input ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/')
  if (!raw) throw new ProjectError('Give the file name, for example "src/app.js".')
  if (raw.length > PROJECT_LIMITS.pathChars) throw new ProjectError(`That file name is longer than ${PROJECT_LIMITS.pathChars} characters.`)
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw new ProjectError(`"${raw}" must be written from the project folder, without a leading / or a drive letter.`)
  if (raw.endsWith('/')) throw new ProjectError(`"${raw}" is a folder. Give the name of a file.`)
  if (!/^[\w.\-/@+()~ ]+$/.test(raw)) throw new ProjectError(`"${raw}" has characters that are not allowed in a file name. Use letters, numbers and . - _ / only.`)
  const parts = raw.split('/')
  if (parts.some(p => p === '.' || p === '..' || p.trim() === '')) throw new ProjectError(`"${raw}" goes outside the project or has an empty part.`)
  if (parts.some(p => p.toLowerCase() === '.git')) throw new ProjectError('Nothing can be saved inside .git.')
  if (parts.some(p => p === 'node_modules')) throw new ProjectError('node_modules is not kept in a project. List the packages in package.json instead.')
  if (isSecretFile(raw)) throw new ProjectError(`"${raw}" looks like a file that holds secrets, so it is never kept in a project. Use a placeholder such as .env.example.`)
  return parts.join('/')
}

/** Why a set of files cannot be kept as a project, or null when it is fine. */
export function projectProblem(files: ProjectFile[]): string | null {
  if (files.length > PROJECT_LIMITS.files) return `A project can hold up to ${PROJECT_LIMITS.files} files.`
  const seen = new Set<string>()
  let total = 0
  for (const file of files) {
    try { if (cleanPath(file.path) !== file.path) return `"${file.path}" is not a clean file name.` } catch (err) { return (err as Error).message }
    if (seen.has(file.path)) return `"${file.path}" is in the project twice.`
    seen.add(file.path)
    if (file.content.includes('\u0000')) return `"${file.path}" is not a plain-text file. Projects keep text only.`
    if (file.content.length > PROJECT_LIMITS.fileChars) return `"${file.path}" is ${file.content.length.toLocaleString('en')} characters, over the ${PROJECT_LIMITS.fileChars.toLocaleString('en')} limit for one file. Split it into smaller files.`
    total += file.content.length
  }
  if (total > PROJECT_LIMITS.totalChars) return `The project would hold ${total.toLocaleString('en')} characters, over the ${PROJECT_LIMITS.totalChars.toLocaleString('en')} limit. Remove files or make them shorter.`
  return null
}

export const sortFiles = (files: ProjectFile[]): ProjectFile[] => [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'))

// ---------------------------------------------------------------------------------------------------------------------
// One page from a project: used for the Preview tab and the "Single page (.html)" download.
// ---------------------------------------------------------------------------------------------------------------------

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** A path written inside `from` (a file in the project), as a path from the project folder. Null for a web address. */
function resolveFrom(from: string, ref: string): string | null {
  const clean = ref.split(/[?#]/)[0]!.trim()
  if (!clean || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return null
  const stack = clean.startsWith('/') ? [] : dirOf(from).split('/').filter(Boolean)
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (!stack.length) return null; stack.pop() } else stack.push(part)
  }
  return stack.join('/')
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(v => v !== undefined) ?? null
const inertJs = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
const inertCss = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1')

class BundleError extends Error {}

/** Looks for the file a path points to, trying the usual endings. */
function findModule(files: Map<string, string>, base: string): string | null {
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) if (files.has(candidate)) return candidate
  return null
}

const IMPORT_FROM = /^[ \t]*import\s+([\s\S]*?)\s+from\s+(['"])([^'"\n]+)\2[ \t]*;?[ \t]*$/gm
const IMPORT_BARE = /^[ \t]*import\s+(['"])([^'"\n]+)\1[ \t]*;?[ \t]*$/gm
const EXPORT_FROM = /^[ \t]*export\s+(\*|\{[\s\S]*?\})\s*(?:as\s+(\w+)\s*)?from\s+(['"])([^'"\n]+)\3[ \t]*;?[ \t]*$/gm

const names = (list: string): Array<[string, string]> => list.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean).map((item) => {
  const [from, to] = item.split(/\s+as\s+/)
  return [from!.trim(), (to ?? from)!.trim()] as [string, string]
})

/** Turns one module into a function body, and lists the modules it needs. Covers the import and export forms code usually uses. */
function transform(path: string, source: string, files: Map<string, string>): { code: string, needs: string[] } {
  const needs: string[] = []
  let counter = 0
  const need = (spec: string) => {
    const target = resolveFrom(path, spec)
    if (target === null || !/^\.{1,2}\//.test(spec)) {
      throw new BundleError(`"${path}" imports "${spec}" from a package or a web address. A preview cannot load those, so use plain files in the project.`)
    }
    const found = findModule(files, target)
    if (!found) throw new BundleError(`"${path}" imports "${spec}" but the project has no such file.`)
    if (!needs.includes(found)) needs.push(found)
    return found
  }
  const exported: Array<[string, string]> = []
  let code = source.replace(/\r\n/g, '\n')

  code = code.replace(EXPORT_FROM, (_m, what: string, alias: string | undefined, _q, spec: string) => {
    const id = need(spec)
    const v = `__r${counter++}`
    if (what === '*') return alias ? `var ${v} = __req(${JSON.stringify(id)}); exports.${alias} = ${v};` : `var ${v} = __req(${JSON.stringify(id)}); for (var k in ${v}) if (k !== 'default') exports[k] = ${v}[k];`
    return `var ${v} = __req(${JSON.stringify(id)}); ${names(what).map(([from, to]) => `exports.${to} = ${v}.${from};`).join(' ')}`
  })

  code = code.replace(IMPORT_FROM, (_m, clause: string, _q, spec: string) => {
    const id = need(spec)
    const v = `__i${counter++}`
    const parts: string[] = [`var ${v} = __req(${JSON.stringify(id)});`]
    const ns = /^(?:(\w+)\s*,\s*)?\*\s+as\s+(\w+)$/.exec(clause.trim())
    if (ns) return `${parts[0]}${ns[1] ? ` var ${ns[1]} = ${v}.default;` : ''} var ${ns[2]} = ${v};`
    const m = /^(?:(\w+)\s*,?\s*)?(\{[\s\S]*\})?$/.exec(clause.trim())
    if (!m) throw new BundleError(`"${path}" has an import this preview does not understand: import ${clause.trim().slice(0, 60)}`)
    if (m[1]) parts.push(`var ${m[1]} = ${v}.default;`)
    if (m[2]) for (const [from, to] of names(m[2])) parts.push(`var ${to} = ${v}.${from};`)
    return parts.join(' ')
  })
  code = code.replace(IMPORT_BARE, (_m, _q, spec: string) => `__req(${JSON.stringify(need(spec))});`)

  // Things exported with their declaration: the word "export" goes, and a getter keeps it live.
  code = code.replace(/^([ \t]*)export\s+default\s+(async\s+function\*?|function\*?|class)\s+(\w+)/gm, (_m, ind: string, kind: string, name: string) => { exported.push(['default', name]); return `${ind}${kind} ${name}` })
  code = code.replace(/^([ \t]*)export\s+default\s+/gm, '$1exports.default = ')
  code = code.replace(/^([ \t]*)export\s+(async\s+function\*?|function\*?|class)\s+(\w+)/gm, (_m, ind: string, kind: string, name: string) => { exported.push([name, name]); return `${ind}${kind} ${name}` })
  code = code.replace(/^([ \t]*)export\s+(const|let|var)\s+(\w+)/gm, (_m, ind: string, kind: string, name: string) => { exported.push([name, name]); return `${ind}${kind} ${name}` })
  code = code.replace(/^[ \t]*export\s*(\{[\s\S]*?\})[ \t]*;?[ \t]*$/gm, (_m, list: string) => { for (const [from, to] of names(list)) exported.push([to, from]); return '' })

  const getters = exported.map(([out, local]) => `${JSON.stringify(out)}: function () { return ${local}; }`).join(', ')
  const header = exported.length ? `__def(exports, { ${getters} });\n` : ''
  return { code: `"use strict";\n${header}${code}`, needs }
}

/** Collects a module and everything it imports into one classic script, so the page can run it with no files beside it. */
function bundleModules(entry: string, files: Map<string, string>, source = files.get(entry) ?? ''): string {
  const modules = new Map<string, string>()
  const walk = (path: string, text: string) => {
    if (modules.has(path)) return
    modules.set(path, '')
    const { code, needs } = transform(path, text, files)
    modules.set(path, code)
    for (const dep of needs) walk(dep, files.get(dep)!)
  }
  walk(entry, source)
  const body = [...modules].map(([path, code]) => `__mods[${JSON.stringify(path)}] = function (exports, __req) {\n${code}\n};`).join('\n')
  return `(function () {\nvar __mods = {}, __cache = {};\nfunction __def(o, g) { for (var k in g) Object.defineProperty(o, k, { enumerable: true, get: g[k] }); }\nfunction __req(id) { if (__cache[id]) return __cache[id].exports; var m = __cache[id] = { exports: {} }; __mods[id](m.exports, __req); return m.exports; }\n${body}\n__req(${JSON.stringify(entry)});\n})();`
}

const SVG_TYPES: Record<string, string> = { svg: 'image/svg+xml' }

/** Picks the page a project opens with: index.html, or the first .html file. */
export function projectEntry(files: ProjectFile[]): string | null {
  if (files.some(f => f.path === 'index.html')) return 'index.html'
  return files.find(f => /\.html?$/i.test(f.path))?.path ?? null
}

/**
 * The whole project as one HTML page: stylesheets, scripts (including modules that import each other) and SVG pictures
 * are put inside it. Returns a plain-words reason when that cannot be done, for example when a script needs a package.
 */
export function bundleProject(files: ProjectFile[], entryPath?: string): { html: string } | { problem: string } {
  const map = new Map(files.map(f => [f.path, f.content]))
  const entry = entryPath ?? projectEntry(files)
  if (!entry || !map.has(entry)) return { problem: 'There is no web page to show yet. Add an index.html to the project.' }
  try {
    let html = map.get(entry)!
    let inline = 0
    html = html.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag
      const href = attr(tag, 'href')
      const target = href ? resolveFrom(entry, href) : null
      if (target === null) return tag
      const css = map.get(target)
      if (css === undefined) throw new BundleError(`${entry} uses the stylesheet "${href}" but the project has no such file.`)
      return `<style>\n${inertCss(css)}\n</style>`
    })
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string, inner: string) => {
      const src = attr(attrs, 'src')
      const isModule = /\btype\s*=\s*["']?module/i.test(attrs)
      if (!src) {
        if (!isModule || !/^[ \t]*(import|export)\b/m.test(inner)) return whole
        return `<script>\n${inertJs(bundleModules(`${dirOf(entry) ? `${dirOf(entry)}/` : ''}__inline${inline++}.js`, map, inner))}\n</script>`
      }
      const target = resolveFrom(entry, src)
      if (target === null) return whole
      const code = map.get(target)
      if (code === undefined) throw new BundleError(`${entry} uses the script "${src}" but the project has no such file.`)
      return `<script>\n${inertJs(isModule ? bundleModules(target, map) : code)}\n</script>`
    })
    html = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (whole, lead: string, quote: string, src: string) => {
      const target = resolveFrom(entry, src)
      const type = target ? SVG_TYPES[target.split('.').pop()!.toLowerCase()] : undefined
      const text = target ? map.get(target) : undefined
      return type && text !== undefined ? `${lead}${quote}data:${type};utf8,${encodeURIComponent(text)}${quote}` : whole
    })
    return { html }
  } catch (err) {
    if (err instanceof BundleError) return { problem: err.message }
    throw err
  }
}
