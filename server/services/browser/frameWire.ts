import { BROWSER_LIMITS } from './model'
import type { Frame, FrameTab } from './session'

/** How a live picture travels between the worker, the app and the page: the JPEG as the body, the rest as headers. */
export function frameHeaders(f: Frame): Record<string, string> {
  return {
    'X-Width': String(f.width),
    'X-Height': String(f.height),
    'X-Control': f.control,
    'X-Url': encodeURIComponent(f.url),
    'X-Title': encodeURIComponent(f.title),
    'X-Tabs': encodeURIComponent(JSON.stringify(f.tabs))
  }
}

export function frameFromHeaders(bytes: Buffer, h: Headers): Frame {
  return {
    bytes,
    width: Number(h.get('x-width')) || BROWSER_LIMITS.viewport.width,
    height: Number(h.get('x-height')) || BROWSER_LIMITS.viewport.height,
    url: safeDecode(h.get('x-url'), 'about:blank'),
    title: safeDecode(h.get('x-title'), ''),
    control: h.get('x-control') === 'person' ? 'person' : 'assistant',
    tabs: parseTabs(h.get('x-tabs'))
  }
}

function safeDecode(value: string | null, fallback: string): string {
  try { return value ? decodeURIComponent(value) : fallback } catch { return fallback }
}

/** Tabs from a header, tolerating anything: a bad header means no tab strip, never an error. */
export function parseTabs(value: string | null): FrameTab[] {
  try {
    const raw = JSON.parse(safeDecode(value, '[]'))
    if (!Array.isArray(raw)) return []
    return raw.slice(0, BROWSER_LIMITS.maxTabs).map(t => ({
      title: String(t?.title ?? '').slice(0, 60),
      host: String(t?.host ?? '').slice(0, 80),
      active: t?.active === true
    }))
  } catch { return [] }
}
