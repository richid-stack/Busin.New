/**
 * The live view of the browser the assistant is using in a chat: the picture of the page, who holds it, and (when the
 * person takes over) their own clicks, typing and scrolling sent to the page.
 *
 * What the person types while they hold the page goes straight to the page. It is not kept here, not logged, and the
 * assistant never sees it.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'

export interface ViewSize { width: number, height: number }

const KEYS: Record<string, string> = {
  Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', PageDown: 'PageDown', PageUp: 'PageUp', Home: 'Home', End: 'End'
}

/** The tab list from a frame's header. A bad header just means no tab strip. */
function readTabs(value: string | null) {
  try {
    const raw = JSON.parse(decodeURIComponent(value ?? '[]'))
    return Array.isArray(raw) ? raw.slice(0, 6).map(t => ({ title: String(t?.title ?? ''), host: String(t?.host ?? ''), active: t?.active === true })) : []
  } catch { return [] }
}

export function useBrowserView(chatId: Ref<string>, active: Ref<boolean>, busy: Ref<boolean>) {
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }
  const image = ref('')
  const url = ref('')
  const title = ref('')
  const tabs = ref<{ title: string, host: string, active: boolean }[]>([])
  const control = ref<'assistant' | 'person'>('assistant')
  const size = ref<ViewSize>({ width: 1100, height: 560 })
  /** There is (or was) a page to show. */
  const seen = ref(false)
  /** The browser for this chat was closed or timed out. */
  const ended = ref(false)
  const error = ref('')
  const working = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true
  let failures = 0
  let blobUrl = ''

  const base = () => `/api/browser/${encodeURIComponent(chatId.value)}`
  const delay = () => (control.value === 'person' ? 450 : busy.value ? 900 : 4000)

  async function tick() {
    timer = null
    if (stopped) return
    if (typeof document !== 'undefined' && document.hidden) return schedule(2000)
    try {
      const res = await fetch(`${base()}/frame`, { cache: 'no-store', credentials: 'same-origin' })
      if (res.status === 404 || res.status === 503) {
        // Nothing open: either not started yet, or finished. Keep looking while the assistant is working.
        if (seen.value) ended.value = true
        failures = 0
        return schedule(busy.value ? 1200 : 6000)
      }
      if (res.status === 401) return stop()
      if (!res.ok) throw new Error('bad')
      const blob = await res.blob()
      const next = URL.createObjectURL(blob)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      blobUrl = next
      image.value = next
      url.value = decodeURIComponent(res.headers.get('x-url') ?? '')
      title.value = decodeURIComponent(res.headers.get('x-title') ?? '')
      tabs.value = readTabs(res.headers.get('x-tabs'))
      control.value = res.headers.get('x-control') === 'person' ? 'person' : 'assistant'
      size.value = { width: Number(res.headers.get('x-width')) || 1100, height: Number(res.headers.get('x-height')) || 560 }
      seen.value = true
      ended.value = false
      failures = 0
      error.value = ''
    } catch {
      failures++
      if (failures >= 4) error.value = 'The live view is not reachable right now.'
    }
    schedule(Math.min(8000, delay() * (1 + failures)))
  }

  function schedule(ms: number) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(tick, ms)
  }
  function start() {
    if (!stopped) return
    stopped = false
    void tick()
  }
  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
  watch(active, on => (on ? start() : stop()), { immediate: true })
  onBeforeUnmount(() => {
    stop()
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  })

  async function post(path: string, body?: Record<string, unknown>) {
    error.value = ''
    working.value = true
    try {
      return await $fetch<any>(`${base()}/${path}`, { method: 'POST', body, headers: headers() })
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.statusMessage || 'That did not work. Try again.'
      throw err
    } finally {
      working.value = false
    }
  }

  async function takeOver() {
    await post('takeover')
    control.value = 'person'
    schedule(100)
  }
  async function handBack() {
    flushNow()
    await queue.catch(() => {})
    await post('handback')
    control.value = 'assistant'
    schedule(100)
  }
  async function close() {
    await post('close').catch(() => {})
    ended.value = true
    control.value = 'assistant'
  }

  // ---- The person's own hands ------------------------------------------------------------------------------------
  // One at a time and in order: a click must land after the typing before it.
  let queue: Promise<unknown> = Promise.resolve()
  const send = (input: Record<string, unknown>) => {
    queue = queue.then(() => $fetch(`${base()}/input`, { method: 'POST', body: { input }, headers: headers() })).catch(() => { error.value = 'That did not reach the page.' })
  }

  let typed = ''
  let typedTimer: ReturnType<typeof setTimeout> | null = null
  let wheel = 0
  let wheelTimer: ReturnType<typeof setTimeout> | null = null
  function flushNow() {
    if (typedTimer) clearTimeout(typedTimer)
    typedTimer = null
    if (typed) { for (let i = 0; i < typed.length; i += 500) send({ kind: 'type', text: typed.slice(i, i + 500) }); typed = '' }
    if (wheelTimer) clearTimeout(wheelTimer)
    wheelTimer = null
    if (wheel) { send({ kind: 'scroll', dy: Math.max(-3000, Math.min(3000, Math.round(wheel))) }); wheel = 0 }
  }

  /** A tap or click on the picture, in the page's own coordinates. */
  function click(el: HTMLElement, e: { clientX: number, clientY: number }) {
    if (control.value !== 'person') return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    flushNow()
    send({ kind: 'click', x: Math.round(((e.clientX - r.left) / r.width) * size.value.width), y: Math.round(((e.clientY - r.top) / r.height) * size.value.height) })
  }
  function typeText(text: string) {
    if (control.value !== 'person' || !text) return
    typed += text
    if (typedTimer) clearTimeout(typedTimer)
    typedTimer = setTimeout(flushNow, 120)
  }
  /** True when the key was handled and the browser should not also act on it. */
  function key(e: KeyboardEvent): boolean {
    if (control.value !== 'person' || e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.key.length === 1) { typeText(e.key); return true }
    const name = e.key === 'Tab' && e.shiftKey ? 'Shift+Tab' : KEYS[e.key]
    if (!name) return false
    flushNow()
    send({ kind: 'key', key: name })
    return true
  }
  function pressKey(name: string) { if (control.value === 'person') { flushNow(); send({ kind: 'key', key: name }) } }
  function scroll(dy: number) {
    if (control.value !== 'person') return
    wheel += dy
    if (!wheelTimer) wheelTimer = setTimeout(flushNow, 120)
  }

  return {
    image, url, title, tabs, control, size, seen, ended, error, working,
    live: computed(() => seen.value && !ended.value),
    takeOver, handBack, close, click, typeText, key, pressKey, scroll, start, stop
  }
}
