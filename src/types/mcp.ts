export interface McpServerView {
  id: string
  name: string
  url: string
  headerName: string
  hasToken: boolean
  enabled: boolean
  approved: Array<{ name: string, description: string }>
  lastError: string
  driftNote: string
}

export interface McpToolListing {
  name: string
  description: string
  inputSchema: { properties?: Record<string, { type?: string, description?: string }>, required?: string[] }
  annotations: { readOnlyHint?: boolean, destructiveHint?: boolean } | null
  status: 'approved' | 'changed' | 'new'
  approved: boolean
}

export interface McpLimits { servers: number, approvedTotal: number, approvedPerServer: number }

export interface McpNewServer { name: string, url: string, headerName?: string, token?: string }
