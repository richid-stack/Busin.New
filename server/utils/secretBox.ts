import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encrypts small secrets (such as a token for a user's own MCP server) before they are stored, so a
 * copy of the database alone does not reveal them. The key comes from SECRETS_KEY, or from
 * SESSION_SECRET when that is the only one set. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export class SecretBoxError extends Error {}

function key(purpose: string): Buffer {
  const material = process.env.SECRETS_KEY || process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secrets-key-not-for-production-use')
  if (material.length < 16) throw new SecretBoxError('Stored secrets need SECRETS_KEY (or SESSION_SECRET) to be set on the server.')
  return Buffer.from(hkdfSync('sha256', createHash('sha256').update(material).digest(), Buffer.alloc(0), `openlobs:${purpose}`, 32))
}

export function seal(plain: string, purpose = 'secret'): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function open(sealed: string, purpose = 'secret'): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !body) throw new SecretBoxError('The stored secret is not readable.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch (err) {
    if (err instanceof SecretBoxError) throw err
    throw new SecretBoxError('The stored secret could not be decrypted (was the server key changed?).')
  }
}
