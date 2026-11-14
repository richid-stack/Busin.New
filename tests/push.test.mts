import { createFakeFirestore } from './fakeFirestore'
import { MAX_DEVICES, getVapidKeys, listSubscriptions, removeSubscription, saveSubscription, sendPushToUser, validEndpoint } from '../server/services/push/push'
import { notifyApprovalWaiting, notifyNeedsYou, notifyTaskFinished, setNotificationSettings } from '../server/services/notifications/notify'
import type { NotifyDeps } from '../server/services/notifications/notify'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e } return null }
const db = createFakeFirestore() as any
const EP = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}-abcdefghijklmnop`
const sub = (n: number) => ({ endpoint: EP(n), p256dh: `p256dh-${n}`, auth: `auth-${n}` })

// ---- Addresses ----
assert(validEndpoint(EP(1)) && validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc') && validEndpoint('https://web.push.apple.com/QWERTY'), 'real push services are accepted')
assert(!validEndpoint('http://fcm.googleapis.com/x') && !validEndpoint('https://localhost/x') && !validEndpoint('https://127.0.0.1/x') && !validEndpoint('https://169.254.169.254/latest') && !validEndpoint('https://user:pw@fcm.googleapis.com/x') && !validEndpoint('not a url') && !validEndpoint('https://intranet/x'), 'http, local, private, credentialed and plain-host addresses are refused')

// ---- Subscriptions ----
await saveSubscription(db, 'alice', { ...sub(1), label: 'Richie phone' })
await saveSubscription(db, 'alice', sub(1))
assert((await listSubscriptions(db, 'alice')).length === 1, 'the same device twice is one device')
assert(((await rejects(() => saveSubscription(db, 'alice', { ...sub(2), endpoint: 'http://x.example.com/a' }))) as any)?.message?.includes('not accepted'), 'a bad address is refused with a plain reason')
assert(await rejects(() => saveSubscription(db, 'alice', { endpoint: EP(3), p256dh: '', auth: '' })) !== null, 'a device with no keys is refused')
for (let i = 10; i < 10 + MAX_DEVICES - 1; i++) await saveSubscription(db, 'alice', sub(i))
assert(((await rejects(() => saveSubscription(db, 'alice', sub(99)))) as any)?.message?.includes(String(MAX_DEVICES)), `a person can have ${MAX_DEVICES} devices, not more`)
await saveSubscription(db, 'alice', sub(10))
assert((await listSubscriptions(db, 'alice')).length === MAX_DEVICES, 'turning alerts on again for a device that is already on still works at the limit')
await saveSubscription(db, 'bob', sub(500))
assert(!(await removeSubscription(db, 'alice', EP(500))) && (await listSubscriptions(db, 'bob')).length === 1, 'nobody can turn off another person\'s device')
assert(await removeSubscription(db, 'bob', EP(500)) && (await listSubscriptions(db, 'bob')).length === 0, 'a person can turn off their own device')

// ---- Keys ----
const k1 = await getVapidKeys(db, {})
const k2 = await getVapidKeys(db, {})
assert(k1.publicKey.length > 60 && k1.privateKey.length > 30 && k1.publicKey === k2.publicKey && k1.privateKey === k2.privateKey, 'keys are made once and then reused')
const stored = [...(db.raw('system_config') as Map<string, any>).values()][0]
assert(stored && !JSON.stringify(stored).includes(k1.privateKey), 'the private key is not stored in plain text')
assert((await getVapidKeys(db, { VAPID_PUBLIC_KEY: 'pub-env', VAPID_PRIVATE_KEY: 'priv-env' })).publicKey === 'pub-env', 'keys set in the environment win')

// ---- Sending ----
const calls: any[] = []
const send = (behave: (endpoint: string) => any) => async (s: any, body: string) => { calls.push({ endpoint: s.endpoint, body: JSON.parse(body) }); const r = behave(s.endpoint); if (r) throw r }
const carol = createFakeFirestore() as any
await saveSubscription(carol, 'carol', sub(1)); await saveSubscription(carol, 'carol', sub(2)); await saveSubscription(carol, 'carol', sub(3))
const gone = Object.assign(new Error('gone'), { statusCode: 410 })
const flaky = Object.assign(new Error('busy'), { statusCode: 500 })
const delivered = await sendPushToUser({ db: carol, send: send(e => e === EP(1) ? gone : e === EP(2) ? flaky : null) }, 'carol', { title: 'T'.repeat(200), body: 'B'.repeat(500), url: '/tasks/abc', tag: 'x' })
assert(delivered === 1 && calls.length === 3, 'one alert per device, and the count is what arrived')
assert(calls[0].body.title.length === 80 && calls[0].body.body.length === 200 && calls[0].body.url === '/tasks/abc', 'long text is cut and the link is carried')
assert((await listSubscriptions(carol, 'carol')).map(s => s.endpoint).sort().join() === [EP(2), EP(3)].join(), 'a device that says it is gone is forgotten; a busy one is kept')
calls.length = 0
assert(await sendPushToUser({ db: carol, send: send(() => null) }, 'nobody', { title: 't', body: 'b', url: '/' }) === 0 && calls.length === 0, 'a person with no devices gets nothing and nothing is sent')
assert(await sendPushToUser({ db: carol, send: async () => { throw new Error('boom') } }, 'carol', { title: 't', body: 'b', url: '/' }) === 0, 'a failing send never throws')
const brokenDb: any = { collection: () => { throw new Error('db down') } }
assert(await sendPushToUser({ db: brokenDb }, 'carol', { title: 't', body: 'b', url: '/' }) === 0, 'a database error never throws')

// ---- Alerts raised by the app ----
const clock = new Date('2026-11-14T09:00:00Z')
const emails: any[] = []; const pushes: any[] = []
const pushCount = 1
const deps = (over: Partial<NotifyDeps> = {}): NotifyDeps => ({
  db: createFakeFirestore() as any, now: () => clock, send: async (m) => { emails.push(m); return { sent: true } },
  contact: async () => ({ email: 'r@example.com', name: 'Richie' }), appUrl: 'https://app.example.com',
  push: async (u, a) => { pushes.push({ u, ...a }); return pushCount }, ...over
})
const hold = { key: 'u1:c1', userId: 'u1', kind: 'task' as const, ref: 'task-9', label: 'Sign in on shop.example.com', createdAt: clock.toISOString(), expiresAt: new Date(clock.getTime() + 30 * 60_000).toISOString() }

{ const d = deps(); pushes.length = 0; emails.length = 0
  assert(await notifyNeedsYou(d, hold) === true && pushes.length === 1 && pushes[0].url === '/tasks/task-9' && emails.length === 1, 'a wait alerts the device and sends the email')
  assert(await notifyNeedsYou(d, hold) === false && pushes.length === 1 && emails.length === 1, 'the same wait alerts only once')
}
{ const d = deps({ contact: async () => ({}) }); pushes.length = 0; emails.length = 0
  assert(await notifyNeedsYou(d, { ...hold, key: 'u1:c2' }) === true && pushes.length === 1 && emails.length === 0, 'a device alone is enough when there is no email address')
}
{ const d = deps(); pushes.length = 0; emails.length = 0
  await setNotificationSettings(d.db, 'u1', { emailNeedsYou: false })
  assert(await notifyNeedsYou(d, { ...hold, key: 'u1:c3' }) === true && pushes.length === 1 && emails.length === 0, 'with the emails switched off the device still hears')
}
{ const d = deps({ push: async () => 0 }); emails.length = 0
  assert(await notifyNeedsYou(d, { ...hold, key: 'u1:c4' }) === true && emails.length === 1, 'with no device on, the email goes as before')
  const d2 = deps({ push: async () => 0, contact: async () => ({}) })
  assert(await notifyNeedsYou(d2, { ...hold, key: 'u1:c5' }) === false, 'no device and no address means no alert')
}
{ const d = deps({ send: async () => ({ sent: false }) }); pushes.length = 0
  assert(await notifyNeedsYou(d, { ...hold, key: 'u1:c6' }) === true && pushes.length === 1 && await notifyNeedsYou(d, { ...hold, key: 'u1:c6' }) === false && pushes.length === 1, 'a failed email does not make the device alert repeat')
}

const finished = { id: 't1', userId: 'u1', goal: 'Research mobile money in Ghana', status: 'done', outcome: 'Done. All criteria met.', startedAt: '2026-11-14T08:00:00Z', finishedAt: '2026-11-14T08:05:00Z' }
{ const d = deps(); pushes.length = 0; emails.length = 0
  assert(await notifyTaskFinished(d, finished) === true && pushes[0]?.title === 'Your task is done' && pushes[0].url === '/tasks/t1' && emails.length === 1, 'a long task alerts the device and sends the email')
  assert(await notifyTaskFinished(d, finished) === false && pushes.length === 1, 'once per task')
  assert(await notifyTaskFinished(deps(), { ...finished, id: 't2', finishedAt: '2026-11-14T08:00:30Z' }) === false, 'a short task you watched sends nothing')
  assert(await notifyTaskFinished(deps(), { ...finished, id: 't3', status: 'cancelled' }) === false, 'a cancelled task sends nothing')
}

const waiting = { userId: 'u1', workflowId: 'w1', workflowName: 'Weekly report', runId: 'r1', prompt: 'Send the report to the board?', chatId: 'chat-approvals' }
{ const d = deps(); pushes.length = 0; emails.length = 0
  assert(await notifyApprovalWaiting(d, waiting) === true && pushes[0]?.title === 'Waiting for your OK' && pushes[0].url === '/chat/chat-approvals' && pushes[0].body.includes('Weekly report'), 'a paused workflow alerts the device and opens the approvals chat')
  assert(emails.length === 1 && /Weekly report/.test(emails[0].subject) && emails[0].text.includes('https://app.example.com/chat/chat-approvals'), 'and the email links to the same chat')
  assert(await notifyApprovalWaiting(d, waiting) === false && pushes.length === 1, 'once per paused run')
  pushes.length = 0
  assert(await notifyApprovalWaiting(deps(), { ...waiting, runId: 'r2', chatId: undefined }) === true && pushes[0].url === '/workflows/w1', 'with no chat card it opens the workflow')
  assert(await notifyApprovalWaiting(deps({ push: async () => 0, contact: async () => ({}) }), { ...waiting, runId: 'r3' }) === false, 'nobody to tell means no alert')
}
