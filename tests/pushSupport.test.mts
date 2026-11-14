import { deviceLabel, pushAvailability, urlBase64ToBytes } from '../src/utils/pushSupport'
import type { PushEnv } from '../src/utils/pushSupport'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const base: PushEnv = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120', standalone: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: 'default' }
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'

assert(pushAvailability(base) === 'ready', 'Chrome on Android can turn alerts on')
assert(pushAvailability({ ...base, userAgent: IPHONE, standalone: false }) === 'needs-install', 'iPhone in Safari must add the app to the Home Screen first')
assert(pushAvailability({ ...base, userAgent: IPHONE, standalone: true }) === 'ready', 'iPhone from the Home Screen can turn alerts on')
assert(pushAvailability({ ...base, hasPushManager: false }) === 'unsupported' && pushAvailability({ ...base, hasServiceWorker: false }) === 'unsupported' && pushAvailability({ ...base, hasNotification: false, permission: 'unsupported' }) === 'unsupported', 'a browser without the pieces says so')
assert(pushAvailability({ ...base, permission: 'denied' }) === 'blocked', 'a refusal in the browser settings shows as blocked')
assert(pushAvailability({ ...base, permission: 'granted' }) === 'ready', 'already allowed is ready')

const bytes = urlBase64ToBytes('BPe-_w')
assert(bytes.length === 4 && bytes[0] === 0x04 && bytes[1] === 0xF7 && bytes[2] === 0xBE && bytes[3] === 0xFF, 'a URL-safe key becomes the right bytes')
assert(deviceLabel(IPHONE) === 'iPhone, Safari' && deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36') === 'Windows, Chrome' && deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120') === 'Windows, Edge' && deviceLabel('???') === 'Device', 'devices get a short readable name')
