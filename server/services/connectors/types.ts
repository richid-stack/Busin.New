/**
 * A connector is a small, declarative description of someone's HTTP API: where it lives, how a
 * person's own key is sent, and the few actions OpenLobs may take. There is no code per service, and a
 * person's key is only ever sent to the connector's own fixed host.
 */
export type ParamType = 'string' | 'number' | 'amount' | 'string_list' | 'enum'

export interface ParamDef {
  name: string
  description: string
  type: ParamType
  required?: boolean
  /** string: longest allowed. string_list: longest item. */
  maxLength?: number
  /** string: must match. */
  pattern?: RegExp
  min?: number
  max?: number
  /** enum: the allowed values. */
  values?: string[]
  /** string_list: most items. */
  maxItems?: number
  default?: string | number
}

export interface ActionDef {
  id: string
  name: string
  description: string
  method: 'GET' | 'POST'
  /** Path under the connector's base URL. `{name}` is replaced by the (URL-encoded) parameter. */
  path: string
  /** Parameters sent in the query string (GET) or the JSON body (POST), under these names. */
  send?: Record<string, string>
  params: ParamDef[]
  /** What the action can cost or change, shown to people and used to limit it. */
  effect: 'read' | 'write'
  /** For `write` actions that cost money or reach other people: most uses per day for one person. */
  dailyLimit?: number
  /** Fixed values always sent (for example a currency default). */
  fixed?: Record<string, unknown>
  /** Turns a response into the short summary given back. */
  summarize?: (body: any) => unknown
}

export interface FieldDef { id: string, label: string, placeholder?: string, help?: string, secret: boolean, pattern?: RegExp }

export type AuthDef =
  | { type: 'bearer', field: string }
  | { type: 'header', header: string, field: string }

export interface ConnectorDef {
  provider: string
  name: string
  icon: string
  category: 'ghana'
  description: string
  /** https only, a fixed host. */
  baseUrl: string
  fields: FieldDef[]
  auth: AuthDef
  actions: ActionDef[]
  links: { website: string, docs: string, getKey: string }
  /** Said to the person before they paste a key. */
  keyAdvice: string
  /** A harmless read used to check a key when it is saved. */
  verifyAction?: string
}
