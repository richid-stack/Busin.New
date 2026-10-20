import type { H3Event } from 'nitro'
import { getHeader } from 'nitro/h3'

/**
 * The public address of the app, for links in emails and for Paystack to send people back to.
 * APP_URL wins when set; otherwise it comes from the request (Cloud Run forwards the real host).
 */
export function appUrl(event: H3Event): string {
  const fixed = (process.env.APP_URL || '').trim().replace(/\/+$/, '')
  if (fixed) return fixed
  const host = getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || ''
  const proto = getHeader(event, 'x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto.split(',')[0]}://${host.split(',')[0]}`
}
