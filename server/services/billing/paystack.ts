import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.paystack.co'

export class PaystackError extends Error {}

export const paystackSecret = (env: NodeJS.ProcessEnv = process.env) => (env.PAYSTACK_SECRET_KEY || '').trim()

export interface PaystackDeps { fetch?: typeof fetch, secret?: string }

async function call(path: string, init: RequestInit, deps: PaystackDeps): Promise<any> {
  const secret = deps.secret ?? paystackSecret()
  if (!secret) throw new PaystackError('Payments are not set up yet.')
  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(`${API}${path}`, {
      ...init,
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    throw new PaystackError('Could not reach the payment service. Try again in a moment.')
  }
  const body: any = await res.json().catch(() => null)
  if (!res.ok || !body?.status) {
    console.warn(`[paystack] ${path.split('?')[0]} failed (${res.status}): ${String(body?.message ?? '').slice(0, 200)}`)
    throw new PaystackError('The payment service refused the request. Try again, or contact us if it keeps happening.')
  }
  return body.data
}

export interface InitializeInput {
  email: string
  /** In the smallest unit (pesewas for GHS). */
  amount: number
  currency: string
  reference: string
  callbackUrl: string
  channels: string[]
  metadata: Record<string, unknown>
}

/** Starts a payment and returns the page the person pays on. */
export async function paystackInitialize(input: InitializeInput, deps: PaystackDeps = {}): Promise<{ authorizationUrl: string, reference: string }> {
  const data = await call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: input.channels,
      metadata: input.metadata
    })
  }, deps)
  if (typeof data?.authorization_url !== 'string' || !data.authorization_url.startsWith('https://')) {
    throw new PaystackError('The payment service did not return a payment page.')
  }
  return { authorizationUrl: data.authorization_url, reference: String(data.reference || input.reference) }
}

export interface VerifiedTransaction {
  status: string
  amount: number
  currency: string
  channel: string
  reference: string
}

/** Asks Paystack what really happened to a payment. This, never a request from a browser, decides. */
export async function paystackVerify(reference: string, deps: PaystackDeps = {}): Promise<VerifiedTransaction> {
  const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }, deps)
  return {
    status: String(data?.status ?? ''),
    amount: Number(data?.amount ?? 0),
    currency: String(data?.currency ?? ''),
    channel: String(data?.channel ?? ''),
    reference: String(data?.reference ?? reference)
  }
}

/** Paystack signs each webhook with HMAC-SHA512 of the raw body, using the secret key. */
export function verifyPaystackSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!secret || !signature) return false
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature).trim().toLowerCase())
  return a.length === b.length && timingSafeEqual(a, b)
}
