import { MODEL_PROVIDERS, providerById, myModelId } from '../../../shared/modelProviders'
import type { ListedModel } from '../../../shared/modelProviders'
import type { ModelConnection } from './store'

export interface ConnectionDetail {
  providerId: string
  baseUrl: string
  models: ListedModel[]
  enabled: string[]
  manual: string[]
  fetchedAt: string
}

/** What the browser may see of a connection: never the key. */
export function viewConnection(c: ModelConnection): ConnectionDetail {
  return { providerId: c.providerId, baseUrl: c.baseUrl, models: c.models, enabled: c.enabled, manual: c.manual, fetchedAt: c.fetchedAt }
}

export function viewProviders(connections: ModelConnection[]) {
  return MODEL_PROVIDERS.map((p) => {
    const c = connections.find(x => x.providerId === p.id)
    return {
      id: p.id, name: p.name, icon: p.icon, keyUrl: p.keyUrl, keyHelp: p.keyHelp, custom: Boolean(p.custom), defaultBaseUrl: p.baseUrl,
      listsModels: !p.fixedModels,
      connected: Boolean(c), baseUrl: c?.baseUrl ?? '', modelsAvailable: c?.models.length ?? 0, enabledCount: c ? c.enabled.length : 0, fetchedAt: c?.fetchedAt ?? ''
    }
  })
}

/** The models the person switched on, ready for the picker in the chat, agents and tasks. */
export function viewMine(connections: ModelConnection[]) {
  return connections.flatMap((c) => {
    const def = providerById(c.providerId)
    if (!def) return []
    const known = new Map(c.models.map(m => [m.id, m]))
    return [...new Set([...c.enabled, ...c.manual.filter(id => c.enabled.includes(id))])].map(id => ({
      value: myModelId(c.providerId, id),
      label: known.get(id)?.label || id,
      provider: def.name,
      providerId: def.id,
      icon: def.icon
    }))
  })
}
