/**
 * The real push library end to end, with a stand-in for the browser maker's push service on this machine:
 * a real browser-style subscription is made, an alert is sent through the app's own code, and the message is decrypted
 * the way a browser would. Proves the encryption, the signed headers and the payload, not Google's or Apple's service.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { createECDH, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeFirestore } from './fakeFirestore'
import { getVapidKeys, sendPushToUser } from '../server/services/push/push'

const ece = createRequire(import.meta.url)('http_ece')
const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const dir = mkdtempSync(join(tmpdir(), 'pushcert-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' })

// The "browser": a real keypair and auth secret.
const browser = createECDH('prime256v1'); browser.generateKeys()
const authSecret = randomBytes(16)
const b64 = (b: Buffer) => b.toString('base64url')

const received: { headers: any, body: Buffer }[] = []
const server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
  const chunks: Buffer[] = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = 201; res.end() })
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as any).port

const db = createFakeFirestore() as any
// saveSubscription refuses local addresses on purpose, so the record is written the way a stored one looks.
await db.collection('push_subscriptions').doc('dev1').set({ id: 'dev1', userId: 'u1', endpoint: `https://localhost:${port}/push/abc`, p256dh: b64(browser.getPublicKey()), auth: b64(authSecret), createdAt: new Date().toISOString() })
const keys = await getVapidKeys(db, {})

const delivered = await sendPushToUser({ db }, 'u1', { title: 'Waiting for your OK', body: 'Weekly report: Send it to the board?', url: '/chat/c1', tag: 'approval__r1' })
assert(delivered === 1 && received.length === 1, 'the alert reached the push service')

const r = received[0]!
assert(r.headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=.+$/.test(String(r.headers.authorization)), 'it is encrypted and carries a signed VAPID header')
assert(String(r.headers.authorization).includes(`k=${keys.publicKey}`), 'signed with the server\'s key')
assert(Number(r.headers.ttl) > 0 && r.headers.urgency === 'high', 'it has a time to live and high urgency')
const plain = ece.decrypt(r.body, { version: 'aes128gcm', privateKey: browser, authSecret })
const msg = JSON.parse(plain.toString('utf8'))
assert(msg.title === 'Waiting for your OK' && msg.body.startsWith('Weekly report') && msg.url === '/chat/c1' && msg.tag === 'approval__r1', 'the browser can decrypt it and read the title, text and link')
assert(!r.body.toString('utf8').includes('Weekly report'), 'the text is not readable on the way')

await new Promise(r => server.close(r))
