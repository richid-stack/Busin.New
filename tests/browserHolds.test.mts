import { createFakeFirestore } from './fakeFirestore'
import { AWAY_AFTER_MS, createHoldStore, processHolds, startWait } from '../server/services/browser/holds'
import { BROWSER_LIMITS } from '../server/services/browser/model'
import type { BrowserService, SessionStatus } from '../server/services/browser/service'
import { notifyNeedsYou, getNotificationSettings, setNotificationSettings } from '../server/services/notifications/notify'
import type { NotifyDeps } from '../server/services/notifications/notify'
import { needsYouEmail } from '../server/services/email/email'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

let clock = new Date('2026-10-30T09:00:00Z')
const now = () => clock
const db = createFakeFirestore() as any
const store = createHoldStore(db, { now })

// What the browser says about each page
const sessions = new Map<string, SessionStatus | null>()
const held: Array<[string, number]> = []
const closed: string[] = []
const service = {
  async status(key: string) { return sessions.has(key) ? sessions.get(key)! : null },
  async hold(key: string, ms: number) { held.push([key, ms]) },
  async close(key: string) { closed.push(key) }
} as unknown as BrowserService
const page = (viewedAgoMs: number | null): SessionStatus => ({ url: 'https://shop.example.com/', title: 'Shop', control: 'assistant', actions: 3, idleLeftMs: 1, holdLeftMs: 1, viewedAgoMs })

const sent: any[] = []
const notifyDeps: NotifyDeps = { db, now, send: async (m) => { sent.push(m); return { sent: true } }, contact: async () => ({ email: 'richie@example.com', name: 'Richie' }), appUrl: 'https://app.example.com' }
const expired: string[] = []
const pass = () => processHolds({ store, service, now, notify: h => notifyNeedsYou({ ...notifyDeps, now }, h), onExpired: async h => { expired.push(h.key) } })

// Starting a wait keeps the page open and records it
await startWait({ service, store }, { key: 'u1:c1', userId: 'u1', kind: 'chat', ref: 'c1', reason: 'approval', label: 'Click “Place order” on shop.example.com' })
assert(held.length === 1 && held[0]![1] === BROWSER_LIMITS.holdMs, 'a wait asks the browser to hold the page for the longest wait')
const rec = await store.get('u1:c1')
assert(rec?.kind === 'chat' && rec.notifiedAt === null && new Date(rec.expiresAt).getTime() - new Date(rec.createdAt).getTime() === BROWSER_LIMITS.holdMs, 'the wait is recorded with its end time')
sessions.set('u1:c1', page(null))

// Too soon: the person may be about to answer
let r = await pass()
assert(r.emailed === 0 && sent.length === 0, 'no email in the first minute')

// A minute on, nobody has looked: email once
clock = new Date(clock.getTime() + AWAY_AFTER_MS + 1000)
r = await pass()
assert(r.emailed === 1 && sent.length === 1 && /needs you|waiting for you/i.test(sent[0].subject) && sent[0].to === 'richie@example.com', 'a minute with nobody looking sends one email')
assert(sent[0].html.includes('https://app.example.com/chat/c1') && sent[0].html.includes('Place order'), 'the email says what is needed and links to the chat')
r = await pass()
assert(r.emailed === 0 && sent.length === 1, 'it is not emailed twice')

// Someone looking at the page means they are here
await startWait({ service, store }, { key: 'u1:c2', userId: 'u1', kind: 'chat', ref: 'c2', reason: 'person', label: 'Sign in' })
sessions.set('u1:c2', page(5000))
clock = new Date(clock.getTime() + AWAY_AFTER_MS + 1000)
r = await pass()
assert(sent.length === 1, 'no email while the person is looking at the page')
sessions.set('u1:c2', page(120_000))
r = await pass()
assert(sent.length === 2 && sent[1].html.includes('/chat/c2'), 'once they stop looking, they are emailed')

// A page that is gone leaves nothing to wait for
await startWait({ service, store }, { key: 'u1:c3', userId: 'u1', kind: 'task', ref: 't9', reason: 'approval', label: 'x' })
clock = new Date(clock.getTime() + AWAY_AFTER_MS + 1000)
r = await pass()
assert(r.cleared === 1 && (await store.get('u1:c3')) === null && !sent.some(m => m.html.includes('/tasks/t9')), 'a wait whose page is gone is dropped without an email')

// The wait runs out: the page is closed and the waiter is told
sessions.set('u1:c1', page(null))
clock = new Date(clock.getTime() + BROWSER_LIMITS.holdMs)
r = await pass()
assert(r.expired >= 1 && closed.includes('u1:c1') && expired.includes('u1:c1') && (await store.get('u1:c1')) === null, 'when the wait runs out the page is closed and the waiter is told')

// Settings
assert((await getNotificationSettings(db, 'n1')).emailNeedsYou === true, 'these emails are on by default')
await setNotificationSettings(db, 'n2', { emailNeedsYou: false })
assert((await getNotificationSettings(db, 'n2')).emailNeedsYou === false && (await getNotificationSettings(db, 'n2')).emailTaskResults === true, 'they can be switched off without touching the other switches')
await store.raise({ key: 'n2:c', userId: 'n2', kind: 'chat', ref: 'c', reason: 'person', label: 'x' })
assert(await notifyNeedsYou(notifyDeps, (await store.get('n2:c'))!) === false, 'switched off means no email')

// The email itself escapes what the page says
const mail = needsYouEmail({ name: 'Richie', what: '<script>x</script> Pay', kind: 'task', minutesLeft: 20, appUrl: 'https://app.example.com', ref: 't1' })
assert(!mail.html.includes('<script>') && mail.html.includes('/tasks/t1') && /task stops/.test(mail.html), 'the email escapes page text and warns a task will stop')
