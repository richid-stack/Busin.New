/** What this browser can do about alerts, worked out from plain facts so it can be tested without a browser. */
export interface PushEnv {
  userAgent: string
  /** True when the page runs as an installed app (Home Screen on iPhone, an installed app elsewhere). */
  standalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: 'default' | 'granted' | 'denied' | 'unsupported'
}

export type PushAvailability =
  /** Alerts can be turned on now. */
  | 'ready'
  /** This browser cannot show alerts at all. */
  | 'unsupported'
  /** iPhone and iPad only allow alerts for an app added to the Home Screen. */
  | 'needs-install'
  /** The person said no in this browser's settings. */
  | 'blocked'

const IOS = /iPhone|iPad|iPod/i

export function pushAvailability(env: PushEnv): PushAvailability {
  // iPadOS can pose as a Mac; a touch-capable "Macintosh" is handled by the caller passing the iPad user agent. Here the user agent is taken as given.
  const ios = IOS.test(env.userAgent)
  if (ios && !env.standalone) return 'needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  if (env.permission === 'denied') return 'blocked'
  return 'ready'
}

/** The public key arrives as URL-safe base64; the browser wants bytes. */
export function urlBase64ToBytes(value: string): Uint8Array {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

/** A short name for this device, so a list of devices is readable. */
export function deviceLabel(userAgent: string): string {
  const os = /iPhone/i.test(userAgent) ? 'iPhone' : /iPad/i.test(userAgent) ? 'iPad' : /Android/i.test(userAgent) ? 'Android' : /Windows/i.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/i.test(userAgent) ? 'Mac' : /Linux/i.test(userAgent) ? 'Linux' : 'Device'
  const browser = /Edg\//i.test(userAgent) ? 'Edge' : /Firefox\//i.test(userAgent) ? 'Firefox' : /(Chrome|CriOS)\//i.test(userAgent) ? 'Chrome' : /Safari\//i.test(userAgent) ? 'Safari' : ''
  return browser ? `${os}, ${browser}` : os
}
