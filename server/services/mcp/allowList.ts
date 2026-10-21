/** Optional allow-list for the whole deployment: comma-separated hostnames; a leading "." allows subdomains. */
export function hostAllowed(host: string, allowList = process.env.MCP_ALLOWED_HOSTS || ''): boolean {
  const entries = allowList.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!entries.length) return true
  const h = host.toLowerCase()
  return entries.some(e => e.startsWith('.') ? h.endsWith(e) || h === e.slice(1) : h === e)
}
