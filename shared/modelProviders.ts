/**
 * The companies whose models a person can use with their own key. Most speak the same "OpenAI-compatible"
 * language, so one connection path covers them; Anthropic and Google have their own.
 *
 * `kind` decides how we talk to it and how its model list is read:
 *  - openai:      OpenAI itself
 *  - anthropic:   Anthropic's own API
 *  - google:      Google's Gemini API
 *  - compatible:  anything that answers GET {baseUrl}/models and POST {baseUrl}/chat/completions
 */
export type ProviderKind = 'openai' | 'anthropic' | 'google' | 'compatible'

export interface ModelProviderDef {
  id: string
  name: string
  /** Logo from the bundled brand set. */
  icon: string
  kind: ProviderKind
  baseUrl: string
  /** Where the person makes a key. */
  keyUrl: string
  keyHelp: string
  /** A provider with no list endpoint: these are offered instead (the person can add others by name). */
  fixedModels?: Array<{ id: string, label: string }>
  /** The person types the address themselves (any other OpenAI-compatible service). */
  custom?: boolean
  /** Works without a key for listing (the key is still needed to chat). */
  listNeedsKey?: boolean
}

export const MODEL_PROVIDERS: ModelProviderDef[] = [
  { id: 'openai', name: 'OpenAI', icon: 'i-brand-openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyHelp: 'Create a secret key on the OpenAI platform. Billing is on your OpenAI account.' },
  { id: 'anthropic', name: 'Anthropic', icon: 'i-brand-claude-color', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', keyHelp: 'Create an API key in the Anthropic Console.' },
  { id: 'google', name: 'Google Gemini', icon: 'i-brand-gemini-color', kind: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', keyHelp: 'Create a key in Google AI Studio. It has a free tier.' },
  { id: 'openrouter', name: 'OpenRouter', icon: 'i-brand-openrouter', kind: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys', keyHelp: 'One key for hundreds of models from many companies, some of them free.' },
  { id: 'groq', name: 'Groq', icon: 'i-brand-groq', kind: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', keyHelp: 'Create a key in the Groq console. It has a free tier.' },
  { id: 'mistral', name: 'Mistral', icon: 'i-brand-mistral-color', kind: 'compatible', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', keyHelp: 'Create a key in La Plateforme.' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'i-brand-deepseek-color', kind: 'compatible', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', keyHelp: 'Create a key on the DeepSeek platform.' },
  { id: 'moonshot', name: 'Kimi (Moonshot)', icon: 'i-brand-kimi-color', kind: 'compatible', baseUrl: 'https://api.moonshot.ai/v1', keyUrl: 'https://platform.kimi.ai/console/api-keys', keyHelp: 'Create a key on the Kimi platform. Use a key from the same site as the address.' },
  { id: 'qwen', name: 'Qwen (Alibaba Cloud)', icon: 'i-brand-qwen-color', kind: 'compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1', keyHelp: 'Create a Model Studio key. This address is the international (Singapore) one; change it under Advanced for other regions.' },
  { id: 'xai', name: 'xAI (Grok)', icon: 'i-brand-xai', kind: 'compatible', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', keyHelp: 'Create a key in the xAI console.' },
  { id: 'together', name: 'Together AI', icon: 'i-brand-together-color', kind: 'compatible', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys', keyHelp: 'Open-source models such as Llama, Qwen and DeepSeek.' },
  { id: 'fireworks', name: 'Fireworks AI', icon: 'i-brand-fireworks', kind: 'compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', keyUrl: 'https://fireworks.ai/account/api-keys', keyHelp: 'Fast open-source models.' },
  { id: 'cerebras', name: 'Cerebras', icon: 'i-brand-cerebras-color', kind: 'compatible', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/platform', keyHelp: 'Very fast inference. It has a free tier.' },
  { id: 'zhipu', name: 'Z.ai (GLM)', icon: 'i-brand-zhipu-color', kind: 'compatible', baseUrl: 'https://api.z.ai/api/paas/v4', keyUrl: 'https://z.ai/manage-apikey/apikey-list', keyHelp: 'Create a key on the Z.ai platform.' },
  {
    id: 'perplexity', name: 'Perplexity', icon: 'i-brand-perplexity-color', kind: 'compatible', baseUrl: 'https://api.perplexity.ai', keyUrl: 'https://www.perplexity.ai/settings/api', keyHelp: 'Answers with live web search. Perplexity does not publish a model list, so its current models are offered below.',
    fixedModels: [{ id: 'sonar', label: 'Sonar' }, { id: 'sonar-pro', label: 'Sonar Pro' }, { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' }, { id: 'sonar-deep-research', label: 'Sonar Deep Research' }]
  },
  { id: 'custom', name: 'Another service', icon: 'i-lucide-plug-zap', kind: 'compatible', baseUrl: '', keyUrl: '', keyHelp: 'Any service that works like OpenAI’s: NVIDIA, SambaNova, DeepInfra, Hugging Face, a company gateway and so on. Paste its base address (the part before /chat/completions).', custom: true }
]

export const providerById = (id: string): ModelProviderDef | undefined => MODEL_PROVIDERS.find(p => p.id === id)

/** The id a person's own model has everywhere in the app: my:<provider>/<model>. */
export const MY_PREFIX = 'my:'
export const myModelId = (providerId: string, model: string) => `${MY_PREFIX}${providerId}/${model}`
export function parseMyModelId(id: string): { providerId: string, model: string } | null {
  if (!id.startsWith(MY_PREFIX)) return null
  const rest = id.slice(MY_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 1 || slash === rest.length - 1) return null
  return { providerId: rest.slice(0, slash), model: rest.slice(slash + 1) }
}

/** A model a connection offers. Everything beyond the id is a hint the provider gave. */
export interface ListedModel {
  id: string
  label: string
  context?: number
  /** Unix seconds, when the provider says. */
  created?: number
  tools?: boolean
  vision?: boolean
  reasoning?: boolean
  free?: boolean
}
