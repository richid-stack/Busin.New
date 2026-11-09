import { MCP_PRESETS } from '../../shared/mcpCatalog'

// The same rule the server uses to name an outside server's tools: mcp_<server>_<tool>.
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'server'

/** The logo of a recommended server when the tool belongs to it (matched by the name it was added under). */
export function mcpLogo(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp_')) return undefined
  const rest = toolName.slice(4)
  return MCP_PRESETS.find(p => p.icon && (rest === slug(p.name) || rest.startsWith(`${slug(p.name)}_`)))?.icon
}
