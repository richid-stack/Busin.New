/** Shared helpers for the workflow canvas. */
import { defaultSchedule } from './schedulePresets'

export type RunStatus = 'running' | 'completed' | 'failed' | 'auth_required' | 'waiting_approval' | 'skipped' | 'rejected'

export interface NodeRuntime {
  status?: RunStatus
  durationMs?: number
  output?: any
  message?: string
}

export const STATUS_META: Record<string, { label: string, icon: string, color: 'success' | 'error' | 'warning' | 'info' | 'neutral' }> = {
  running: { label: 'Running', icon: 'i-lucide-loader-2', color: 'info' },
  completed: { label: 'Completed', icon: 'i-lucide-circle-check', color: 'success' },
  failed: { label: 'Failed', icon: 'i-lucide-circle-x', color: 'error' },
  auth_required: { label: 'Needs connection', icon: 'i-lucide-plug-zap', color: 'warning' },
  waiting_approval: { label: 'Waiting for approval', icon: 'i-lucide-user-check', color: 'warning' },
  rejected: { label: 'Rejected', icon: 'i-lucide-ban', color: 'error' },
  skipped: { label: 'Skipped', icon: 'i-lucide-skip-forward', color: 'neutral' }
}

/** Fields that exist only while editing or running; never persisted with a workflow. */
const TRANSIENT_DATA_KEYS = ['status', 'durationMs', 'output']

export const EDGE_STYLE = { stroke: 'var(--ui-border-accented)', strokeWidth: 2 }

/** The persisted shape of the canvas (no selection, measurements or run state). */
export function serializeGraph(nodes: any[], edges: any[]) {
  return {
    nodes: nodes.map((node) => {
      const data = { ...(node.data || {}) }
      for (const key of TRANSIENT_DATA_KEYS) delete data[key]
      return {
        id: node.id,
        type: node.type,
        position: { x: Math.round(node.position?.x ?? 0), y: Math.round(node.position?.y ?? 0) },
        data
      }
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      animated: edge.animated ?? true,
      style: edge.style ?? EDGE_STYLE
    }))
  }
}

export interface NodeDefinition {
  type: string
  subtype?: string
  title: string
  subtitle?: string
  icon?: string
  color?: string
  comingSoon?: boolean
  [key: string]: any
}

/** Builds a canvas node from a library entry (used by both click-to-add and drag-and-drop). */
export function createNode(def: NodeDefinition, position: { x: number, y: number }, defaultModel: string) {
  const { type, subtype, title, subtitle, icon, color, ...extra } = def
  delete extra.comingSoon

  const data: Record<string, any> = { title, subtitle, icon, color, subtype, ...extra }
  if (type === 'agent') {
    data.model = defaultModel
    data.prompt = ''
  }
  if (type === 'action') {
    // Library entries for a specific app (Slack, Drive) preselect it; others start empty.
    data.provider = subtype && subtype !== 'api' && subtype !== 'web-fetch' ? subtype : ''
  }
  if (type === 'trigger' && subtype === 'schedule') data.schedule = defaultSchedule()
  // Each node gets its own copy of the library's starting settings.
  if (extra.config) data.config = structuredClone(extra.config)

  return {
    id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
    type,
    position,
    data
  }
}

/**
 * Logic nodes made by the library carry a `subtype`; older nodes (and AI-generated ones) only
 * have it in their id or title.
 */
export function logicKind(node: { id: string, data?: Record<string, any> }): 'if-else' | 'switch' | 'code' | 'loop' | 'set' | null {
  const subtype = node.data?.subtype
  if (subtype === 'if-else' || subtype === 'switch' || subtype === 'code' || subtype === 'loop' || subtype === 'set') return subtype
  const id = node.id.toLowerCase()
  const title = String(node.data?.title ?? '').toLowerCase()
  if (id.startsWith('logic-if') || /\bif\b/.test(title)) return 'if-else'
  if (id.startsWith('logic-switch') || /\bswitch\b/.test(title)) return 'switch'
  if (id.startsWith('logic-code') || /\b(javascript|code)\b/.test(title)) return 'code'
  return null
}

/** The fields a step produces, known before it has run, so they can be offered in the variable picker. */
export function knownOutputKeys(node: { type: string, data?: Record<string, any> }): string[] | null {
  const d = node.data ?? {}
  if (node.type === 'action' && d.subtype === 'api') return ['status', 'ok', 'body', 'headers', 'url']
  if (node.type === 'action' && d.subtype === 'web-fetch') return ['content', 'title', 'url', 'truncated']
  if (node.type === 'logic' && d.subtype === 'loop') return ['results', 'outputs', 'count', 'succeeded', 'failed']
  if (node.type === 'logic' && d.subtype === 'set') {
    const keys = ((d.config?.fields ?? []) as Array<{ key?: string }>).map(f => f.key).filter((k): k is string => Boolean(k))
    return keys.length ? keys : null
  }
  return null
}
