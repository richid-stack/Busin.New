import { LoopGuard, pageKey } from '../server/services/browser/loops'
import type { BrowserAction, PageState } from '../server/services/browser/model'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const page = (text: string, y = 0, over: Partial<PageState> = {}): PageState => ({ url: 'https://shop.example.com/', title: 'Shop', elements: [{ ref: 1, role: 'button', name: 'Next', inView: true }, { ref: 2, role: 'button', name: 'Back', inView: true }], text, scroll: { y, max: 1000 }, focus: { ref: null, inSearch: false, inForm: false }, hasPassword: false, blocker: null, dialogs: [], tabs: 1, truncated: false, ...over })
const click = (ref: number): BrowserAction => ({ action: 'click', ref });

// Same step on the same page: fine twice, refused the third time.
;{
  const g = new LoopGuard()
  const p = page('Step 1')
  assert(g.check(click(1), p) === null, 'a first step is fine')
  g.record(click(1), p)
  assert(g.check(click(1), p) === null, 'the same step a second time is allowed (pages are slow, clicks miss)')
  g.record(click(1), p)
  const msg = g.check(click(1), p)
  assert(typeof msg === 'string' && /already tried this 2 times/.test(msg) && /Do not try it again/.test(msg), 'the third time is refused and says what to do')
}

// A page that changed is not a loop.
;{
  const g = new LoopGuard()
  for (let i = 1; i <= 6; i++) {
    const p = page(`Step ${i}`)
    assert(g.check(click(1), p) === null, `clicking Next on a page that keeps changing is fine (${i})`)
    g.record(click(1), p)
  }
}

// Scrolling down a long page moves the page, so it is not a loop either.
;{
  const g = new LoopGuard()
  const scroll: BrowserAction = { action: 'scroll', direction: 'down', amount: 500 }
  let ok = true
  for (let i = 0; i < 6; i++) {
    const p = page('Long page', i * 500)
    ok = ok && g.check(scroll, p) === null
    g.record(scroll, p)
  }
  assert(ok, 'scrolling down a long page is not a loop')
}

// Two steps that undo each other.
;{
  const g = new LoopGuard()
  const p = page('Same')
  const steps = [click(1), click(2), click(1), click(2)]
  const results: (string | null)[] = []
  for (const s of steps) { results.push(g.check(s, p)); g.record(s, p) }
  assert(results.slice(0, 3).every(r => r === null), 'back-and-forth is allowed for a while')
  assert(typeof results[3] === 'string' && /circle|already tried/.test(results[3]!), 'back-and-forth repeated is caught')
}

// Three steps in a cycle.
;{
  const g = new LoopGuard()
  const p = page('Same')
  const steps = [click(1), click(2), { action: 'read' } as BrowserAction, click(1), click(2), { action: 'read' } as BrowserAction]
  const results: (string | null)[] = []
  for (const s of steps) { results.push(g.check(s, p)); g.record(s, p) }
  assert(results.slice(0, 5).every(r => r === null) && typeof results[5] === 'string', 'a three-step cycle is caught on its second round')
}

// Why it failed last time is passed on.
;{
  const g = new LoopGuard()
  const p = page('Step 1')
  g.record(click(1), p); g.failed(click(1), p, 'The page changed under that step,\n so it was not done.')
  g.record(click(1), p)
  const msg = g.check(click(1), p)
  assert(typeof msg === 'string' && /Last time it failed: The page changed under that step, so it was not done\./.test(msg), 'the earlier failure is quoted on one line')
}

// The page fingerprint
;{
  assert(pageKey(page('A')) === pageKey(page('A')), 'the same page has the same key')
  assert(pageKey(page('A')) !== pageKey(page('B')), 'different text, different key')
  assert(pageKey(page('A')) !== pageKey(page('A', 0, { elements: [{ ref: 1, role: 'textbox', name: 'Name', value: 'Richie', inView: true }] })), 'a filled-in field changes the key')
  assert(pageKey(null) === '', 'no page, no key')
}
