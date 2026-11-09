import type { ListedModel } from '../../shared/modelProviders'

export interface ProviderRow {
  id: string
  name: string
  icon: string
  keyUrl: string
  keyHelp: string
  custom: boolean
  defaultBaseUrl: string
  listsModels: boolean
  connected: boolean
  baseUrl: string
  modelsAvailable: number
  enabledCount: number
  fetchedAt: string
}

export interface ProviderDetail {
  providerId: string
  baseUrl: string
  models: ListedModel[]
  enabled: string[]
  manual: string[]
  fetchedAt: string
}

export interface MyModel { value: string, label: string, provider: string, providerId: string, icon: string }
