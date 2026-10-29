import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import { DEFAULT_VOICE_SETTINGS, normaliseVoiceSettings, type VoiceService, type VoiceSettings } from '../../shared/voice'
import { useCsrf } from './useCsrf'

export interface VoiceKeyRow { service: VoiceService, last4: string, savedAt?: string | number }

const BROWSER_VOICE_KEY = 'lobby.browserVoice'
const readLocal = (): string => { try { return localStorage.getItem(BROWSER_VOICE_KEY) || '' } catch { return '' } }

/** How Lobby listens and speaks for this person, and the keys saved for it. The browser's own voice is chosen per device. */
export const useVoiceSettings = createSharedComposable(() => {
  const settings = ref<VoiceSettings>(structuredClone(DEFAULT_VOICE_SETTINGS))
  const keys = ref<VoiceKeyRow[]>([])
  const fromChat = ref<Record<string, boolean>>({})
  const browserVoice = ref(readLocal())
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const headers = () => ({ [headerName]: csrf() })
  const messageOf = (e: any, fallback: string) => e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback

  async function load(force = false) {
    if ((loaded.value && !force) || loading.value) return
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ settings: VoiceSettings, keys: VoiceKeyRow[], fromChat: Record<string, boolean> }>('/api/voice/settings', { headers: headers() })
      settings.value = normaliseVoiceSettings(res.settings)
      keys.value = res.keys
      fromChat.value = res.fromChat
    } catch (e: any) {
      // Signed out or offline: Lobby still works with the free browser voice.
      error.value = messageOf(e, 'Could not load your voice settings.')
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  async function save(next: VoiceSettings) {
    const clean = normaliseVoiceSettings(next)
    const before = settings.value
    settings.value = clean
    try {
      settings.value = normaliseVoiceSettings(await $fetch('/api/voice/settings', { method: 'PUT', headers: headers(), body: clean }))
    } catch (e: any) {
      settings.value = before
      throw new Error(messageOf(e, 'Could not save your voice settings.'))
    }
  }

  async function saveKey(service: VoiceService, key: string) {
    try {
      const res = await $fetch<{ service: VoiceService, last4: string }>('/api/voice/keys', { method: 'PUT', headers: headers(), body: { service, key } })
      keys.value = [...keys.value.filter(k => k.service !== service), { service, last4: res.last4 }]
    } catch (e: any) {
      throw new Error(messageOf(e, 'Could not save that key.'))
    }
  }

  async function removeKey(service: VoiceService) {
    try {
      await $fetch(`/api/voice/keys/${service}`, { method: 'DELETE', headers: headers() })
      keys.value = keys.value.filter(k => k.service !== service)
    } catch (e: any) {
      throw new Error(messageOf(e, 'Could not remove that key.'))
    }
  }

  function chooseBrowserVoice(uri: string) {
    browserVoice.value = uri
    try { localStorage.setItem(BROWSER_VOICE_KEY, uri) } catch { /* private window: the choice lasts until the page closes */ }
  }

  return { settings, keys, fromChat, browserVoice, loaded, loading, error, load, save, saveKey, removeKey, chooseBrowserVoice }
})
