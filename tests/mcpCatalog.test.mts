import { MCP_PRESETS, presetById } from '../shared/mcpCatalog'
import { checkServerUrl, endpointFor, serverInputSchema } from '../server/services/mcp/server'
import { SUPPORTED_THIRD_PARTY_TOOLKITS } from '../server/services/composio/client'
import { ALL_INTEGRATIONS_CATALOG } from '../server/services/integrations/registry'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- The recommended servers shelf ----
assert(MCP_PRESETS.length >= 6 && new Set(MCP_PRESETS.map(p => p.id)).size === MCP_PRESETS.length && new Set(MCP_PRESETS.map(p => p.url)).size === MCP_PRESETS.length, 'every recommended server has its own id and address')
for (const p of MCP_PRESETS) {
  const ok = serverInputSchema.safeParse({ name: p.name, url: p.url, headerName: p.headerName, token: p.auth === 'key' ? 'test-key' : '' })
  assert(ok.success, `${p.name}: accepted by the same checks as a hand-typed server`)
  let checked = ''
  try { checked = checkServerUrl(p.url) } catch { /* reported below */ }
  assert(checked.startsWith('https://') && !new URL(checked).search, `${p.name}: a plain public https address`)
  assert(p.summary.length > 20 && /^https:\/\//.test(p.docsUrl) && /^\d{4}-\d{2}-\d{2}$/.test(p.checked), `${p.name}: says what it does, links to the maker's docs, and when it was checked`)
  assert(p.auth === 'none' || (!!p.keyHelp && /^https:\/\//.test(p.keyUrl ?? '')), `${p.name}: a key-based server tells the person where to get the key`)
}
assert(MCP_PRESETS.filter(p => p.access === 'changes').every(p => !!p.caution || !!p.keyHelp), 'a server that can change things says so and says how to limit it')
assert(presetById('stitch')?.headerName === 'X-Goog-Api-Key' && presetById('nope') === undefined, 'presets can be looked up')
{
  const bearer = endpointFor({ url: 'https://mcp.context7.com/mcp', headerName: 'Authorization', sealedToken: '' } as any)
  assert(Object.keys(bearer.headers).length === 0, 'a server with no key sends no sign-in header')
}
assert(!MCP_PRESETS.some(p => /linear|slack|jira|atlassian|figma|canva|notion/i.test(p.name)), 'apps that need a browser sign-in, or that were put off, are not on the shelf')

// ---- Canva and Figma, through Composio ----
for (const slug of ['canva', 'figma']) {
  const tk = SUPPORTED_THIRD_PARTY_TOOLKITS.find(t => t.slug === slug)
  assert(!!tk && tk.category === 'design' && tk.popularActions.length > 0 && tk.popularActions.every(a => a.slug.startsWith(`${slug.toUpperCase()}_`)), `${slug}: a Composio toolkit in the Design category with real tool names`)
  const item = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === slug)
  assert(item?.type === 'composio' && item.category === 'design', `${slug}: shows on the Integrations page`)
}
assert(new Set(SUPPORTED_THIRD_PARTY_TOOLKITS.map(t => t.slug)).size === SUPPORTED_THIRD_PARTY_TOOLKITS.length, 'no toolkit is listed twice')
