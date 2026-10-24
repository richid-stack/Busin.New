/**
 * MCP servers that were checked against their makers' own documentation and work with how OpenLobs connects:
 * a public https address, with an optional token sent in one header. Nothing here is switched on for anyone:
 * adding one only fills in the "Add server" form, and the person still reads and approves each tool.
 * Servers that need a browser sign-in (OAuth) are not here; those go through Composio (Canva, Figma, ...).
 */
export interface McpPreset {
  id: string
  name: string
  url: string
  headerName: string
  /** none: no sign-in. key: the person pastes a key from the maker's site. */
  auth: 'none' | 'key'
  /** What it gives the assistant, in plain words. */
  summary: string
  /** read: only reads. changes: it can also create or change things, depending on the key given. */
  access: 'read' | 'changes'
  /** Where to get the key, and what kind to make. */
  keyHelp?: string
  keyUrl?: string
  /** Anything the person should know first. */
  caution?: string
  docsUrl: string
  /** When the entry was last checked against the maker's documentation. */
  checked: string
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'stitch',
    name: 'Google Stitch',
    url: 'https://stitch.googleapis.com/mcp',
    headerName: 'X-Goog-Api-Key',
    auth: 'key',
    summary: 'Design screens and interfaces with Google Stitch, then read their code and pictures.',
    access: 'changes',
    keyHelp: 'Make an API key in your Stitch settings (stitch.withgoogle.com). It creates designs in your own Stitch account.',
    keyUrl: 'https://stitch.withgoogle.com',
    caution: 'Some people have had trouble making the key or got sign-in errors when generating a screen. If it fails, tell Claude the error and we will look.',
    docsUrl: 'https://github.com/google-labs-code/stitch-sdk',
    checked: '2026-10-23'
  },
  {
    id: 'context7',
    name: 'Context7',
    url: 'https://mcp.context7.com/mcp',
    headerName: 'Authorization',
    auth: 'key',
    summary: 'Up-to-date documentation and code examples for programming libraries.',
    access: 'read',
    keyHelp: 'Create a free API key in your Context7 dashboard.',
    keyUrl: 'https://context7.com/dashboard',
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    checked: '2026-10-23'
  },
  {
    id: 'microsoft-learn',
    name: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/api/mcp',
    headerName: 'Authorization',
    auth: 'none',
    summary: 'Search and read Microsoft\'s official documentation (Azure, Windows, Microsoft 365, .NET).',
    access: 'read',
    docsUrl: 'https://learn.microsoft.com/training/support/mcp',
    checked: '2026-10-23'
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    url: 'https://mcp.deepwiki.com/mcp',
    headerName: 'Authorization',
    auth: 'none',
    summary: 'Ask questions about any public GitHub project and read its generated documentation.',
    access: 'read',
    caution: 'Public repositories only. What you ask is sent to DeepWiki.',
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    checked: '2026-10-23'
  },
  {
    id: 'google-developer-knowledge',
    name: 'Google Developer Knowledge',
    url: 'https://developerknowledge.googleapis.com/mcp',
    headerName: 'X-Goog-Api-Key',
    auth: 'key',
    summary: 'Search Google\'s official developer documentation (Firebase, Google Cloud, Android, Chrome and more).',
    access: 'read',
    keyHelp: 'In Google Cloud, enable the Developer Knowledge API and create an API key. Restrict it to that API.',
    keyUrl: 'https://developers.google.com/knowledge/mcp',
    docsUrl: 'https://developers.google.com/knowledge/mcp',
    checked: '2026-10-23'
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp',
    headerName: 'Authorization',
    auth: 'key',
    summary: 'Read repositories, issues and pull requests, and, if the key allows it, change them.',
    access: 'changes',
    keyHelp: 'Make a fine-grained personal access token with read-only access to just the repositories you want. Give write access only when you are sure.',
    keyUrl: 'https://github.com/settings/personal-access-tokens/new',
    caution: 'Text inside issues and pull requests can try to give the assistant orders. A read-only token limits the damage.',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server',
    checked: '2026-10-23'
  }
]

export const presetById = (id: string) => MCP_PRESETS.find(p => p.id === id)
