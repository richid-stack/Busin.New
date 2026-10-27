/**
 * What may appear when a stranger's README is shown. The text is read by the same parser as the chat, then
 * rebuilt from a short list of plain tags. Anything else is dropped: raw HTML, scripts, event handlers,
 * images (they can be used to watch who reads), and links to anything but web and email addresses.
 */
export type RawNode = string | [string, Record<string, unknown>, ...RawNode[]]
export type SafeNode = string | { tag: string, href?: string, children: SafeNode[] }

const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em', 'del', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])
const VOID = new Set(['hr', 'br'])
/** Tags that are dropped together with everything inside them. */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'textarea', 'select', 'template', 'noscript', 'head', 'title', 'link', 'meta', 'button', 'audio', 'video', 'canvas'])
const SAFE_LINK = /^(https?:\/\/|mailto:)/i

export function safeNodes(nodes: RawNode[]): SafeNode[] {
  const out: SafeNode[] = []
  for (const node of nodes) {
    if (typeof node === 'string') { out.push(node); continue }
    if (!Array.isArray(node)) continue
    const [tag, attrs, ...children] = node
    const name = String(tag).toLowerCase()
    if (DROP.has(name)) continue
    if (name === 'a') {
      const href = String(attrs?.href ?? '').trim()
      out.push(SAFE_LINK.test(href) ? { tag: 'a', href, children: safeNodes(children) } : { tag: 'span', children: safeNodes(children) })
    } else if (name === 'img') {
      out.push({ tag: 'span', children: [`[image: ${String(attrs?.alt || 'no description').slice(0, 80)}]`] })
    } else if (name === 'input') {
      out.push(attrs?.checked || attrs?.[':checked'] ? '☑ ' : '☐ ')
    } else if (VOID.has(name)) {
      out.push({ tag: name, children: [] })
    } else if (KEEP.has(name) || /^h[1-6]$/.test(name)) {
      out.push({ tag: name, children: safeNodes(children) })
    } else {
      // Any other tag (a span, a div, a custom component): keep what is inside, lose the tag and its attributes.
      out.push({ tag: 'span', children: safeNodes(children) })
    }
  }
  return out
}
