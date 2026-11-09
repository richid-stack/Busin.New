import net from 'node:net'

/**
 * Which kind of place an IP address is. Every way of writing an address has to give the same answer, so the
 * address is parsed into numbers first: ::ffff:192.168.1.1 and ::ffff:c0a8:101 are the same router, and so are
 * the 6to4 and NAT64 forms that carry an IPv4 address inside an IPv6 one.
 */
export type AddressKind = 'public' | 'loopback' | 'private'

function v4Kind(a: number, b: number): AddressKind {
  if (a === 127) return 'loopback'
  if (a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 192 && b === 88) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) || (a === 203 && b === 0) || a >= 224) return 'private'
  return 'public'
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function groupsOf(raw: string): number[] | null {
  let s = raw.toLowerCase().replace(/^\[|\]$/g, '')
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (!net.isIPv6(s)) return null
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const p = dotted[2]!.split('.').map(Number)
    s = `${dotted[1]}${(((p[0] ?? 0) << 8) | (p[1] ?? 0)).toString(16)}:${(((p[2] ?? 0) << 8) | (p[3] ?? 0)).toString(16)}`
  }
  const halves = s.split('::')
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  const groups = halves.length > 1 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head
  if (groups.length !== 8) return null
  const out = groups.map(g => Number.parseInt(g, 16))
  return out.some(n => !Number.isFinite(n)) ? null : out
}

export function addressKind(raw: string): AddressKind {
  const text = raw.trim().replace(/^\[|\]$/g, '')
  if (net.isIPv4(text)) {
    const [a, b] = text.split('.').map(Number) as [number, number]
    return v4Kind(a, b)
  }
  const g = groupsOf(text)
  if (!g) return 'private' // anything that is not an address we can read is not trusted
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number]
  const embedded = (hi: number) => v4Kind(hi >> 8, hi & 255)
  if (g.slice(0, 7).every(n => n === 0) && g7 === 1) return 'loopback' // ::1
  if (g.every(n => n === 0)) return 'private' // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return embedded(g6) // IPv4-mapped and IPv4-compatible
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6) // NAT64
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return 'private' // local-use NAT64
  if (g0 === 0x2002) return embedded(g1) // 6to4
  if (g0 === 0x2001 && g1 === 0) return 'private' // Teredo
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00) return 'private'
  if (g0 === 0x2001 && g1 === 0x0db8) return 'private'
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return 'private'
  return 'public'
}

export const isLoopbackAddress = (ip: string) => addressKind(ip) === 'loopback'
export const isPrivateNetworkAddress = (ip: string) => addressKind(ip) === 'private'
