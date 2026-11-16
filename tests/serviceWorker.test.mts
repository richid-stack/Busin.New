import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

function load() {
  const handlers: Record<string, (e: any) => void> = {}
  const shown: any[] = []
  const opened: string[] = []
  const navigated: string[] = []
  const focused: string[] = []
  let windows: any[] = []
  const self: any = {
    location: { origin: 'https://app.example.com' },
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }) } },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (u: string) => { opened.push(u) }
    },
    skipWaiting: () => {},
    addEventListener: (name: string, fn: (e: any) => void) => { handlers[name] = fn }
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, Promise })
  const fire = async (name: string, e: any) => { let p: Promise<unknown> = Promise.resolve(); handlers[name]!({ ...e, waitUntil: (x: Promise<unknown>) => { p = x } }); await p }
  const win = (url: string) => ({ url, focus: async () => { focused.push(url) }, navigate: async (u: string) => { navigated.push(u) } })
  return { fire, shown, opened, navigated, focused, setWindows: (w: any[]) => { windows = w }, win }
}
const tapped = (url: any) => ({ notification: { close: () => {}, data: { url } } })

{ const w = load()
  await w.fire('push', { data: { json: () => ({ title: 'Your task is done', body: 'All criteria met.', url: '/tasks/abc', tag: 'k' }) } })
  assert(w.shown.length === 1 && w.shown[0].title === 'Your task is done' && w.shown[0].options.body === 'All criteria met.' && w.shown[0].options.data.url === '/tasks/abc' && w.shown[0].options.tag === 'k', 'a push shows an alert with its title, text and link')
  await w.fire('push', { data: { json: () => { throw new Error('bad') } } })
  assert(w.shown[1].title === 'OpenLobs' && w.shown[1].options.data.url === '/', 'a push with unreadable data still shows a plain alert')
  await w.fire('push', { data: { json: () => ({ title: 'T'.repeat(300), body: 'B'.repeat(900) }) } })
  assert(w.shown[2].title.length === 80 && w.shown[2].options.body.length === 200, 'long text is cut')
}
{ const w = load()
  await w.fire('notificationclick', tapped('/tasks/abc'))
  assert(w.opened.join() === 'https://app.example.com/tasks/abc', 'tapping with the app closed opens the page')
}
{ const w = load(); w.setWindows([w.win('https://app.example.com/chat/x')])
  await w.fire('notificationclick', tapped('/tasks/abc'))
  assert(w.focused.length === 1 && w.navigated.join() === 'https://app.example.com/tasks/abc' && w.opened.length === 0, 'tapping with the app open brings it forward and goes to the page')
}
for (const evil of ['https://evil.example/phish', '//evil.example/phish', 'javascript:alert(1)', 42, undefined]) {
  const w = load()
  await w.fire('notificationclick', tapped(evil))
  assert(w.opened.join() === 'https://app.example.com/', `a link to somewhere else (${String(evil)}) opens the app home instead`)
}
{ const w = load(); w.setWindows([w.win('https://other.example/')])
  await w.fire('notificationclick', tapped('/tasks/abc'))
  assert(w.focused.length === 0 && w.opened.length === 1, 'a window on another site is never used')
}
