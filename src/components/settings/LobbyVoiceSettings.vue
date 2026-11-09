<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { VOICE_LIMITS, VOICE_SERVICES, normaliseVoiceSettings, voiceService, type VoiceService, type VoiceSettings } from '../../../shared/voice'
import { useVoiceSettings } from '../../composables/useVoiceSettings'
import { rankBrowserVoices } from '../../utils/browserVoice'
import { browserCanSpeak, fetchSpeech, playUrl, speakInBrowser, type Playback } from '../../utils/lobbyAudio'

/** How Lobby listens and speaks: which service, which model, which voice, how fast, and the keys for them. */
const toast = useToast()
const voice = useVoiceSettings()
const draft = computed(() => voice.settings.value)
onMounted(() => { void voice.load() })

const errorText = (e: any, fallback: string) => e?.message || fallback
async function commit(next: VoiceSettings) {
  try { await voice.save(next) } catch (e: any) { toast.add({ title: 'Could not save', description: errorText(e, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' }) }
}

const listeners = VOICE_SERVICES.filter(s => s.listen.length)
const speakers = VOICE_SERVICES.filter(s => s.speak.length)
const serviceItems = (list: typeof VOICE_SERVICES) => list.map(s => ({ label: s.name, value: s.id, icon: s.icon }))
const choiceItems = (list: Array<{ id: string, label: string }>) => list.map(c => ({ label: c.label, value: c.id }))

const listenDef = computed(() => voiceService(draft.value.listen.service)!)
const speakDef = computed(() => voiceService(draft.value.speak.service)!)

const setListenService = (service: VoiceService) => commit(normaliseVoiceSettings({ ...draft.value, listen: { service, model: '' } }))
const setListenModel = (model: string) => commit({ ...draft.value, listen: { ...draft.value.listen, model } })
const setSpeakService = (service: VoiceService) => commit(normaliseVoiceSettings({ ...draft.value, speak: { service, model: '', voice: '' } }))
const setSpeakModel = (model: string) => commit({ ...draft.value, speak: { ...draft.value.speak, model } })
const setVoice = (v: string) => commit({ ...draft.value, speak: { ...draft.value.speak, voice: v } })
const setKeep = (keepListening: boolean) => commit({ ...draft.value, keepListening })
const speed = ref(draft.value.speed)
watch(() => draft.value.speed, (v) => { speed.value = v })
const setSpeed = (v: number | undefined) => { if (typeof v === 'number') commit({ ...draft.value, speed: v }) }

// A voice id typed in by hand (ElevenLabs has a huge library).
const customVoice = ref('')
const voiceIsListed = computed(() => speakDef.value.voices.some(v => v.id === draft.value.speak.voice))
async function useCustomVoice() {
  const id = customVoice.value.trim()
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) { toast.add({ title: 'That does not look like a voice id', description: 'It is letters and numbers, 4 to 64 long.', icon: 'i-lucide-alert-circle', color: 'warning' }); return }
  await commit({ ...draft.value, speak: { ...draft.value.speak, voice: id } })
  customVoice.value = ''
}

// The voices built into this browser vary by device, so they are listed live.
const BEST = 'best'
const deviceVoices = ref<SpeechSynthesisVoice[]>([])
const readDeviceVoices = () => { if (browserCanSpeak()) deviceVoices.value = rankBrowserVoices(window.speechSynthesis.getVoices()) }
onMounted(readDeviceVoices)
if (typeof window !== 'undefined' && browserCanSpeak()) useEventListener(window.speechSynthesis, 'voiceschanged', readDeviceVoices)
const deviceItems = computed(() => [{ label: 'The best voice on this device', value: BEST }, ...deviceVoices.value.map(v => ({ label: `${v.name} (${v.lang})`, value: v.voiceURI }))])

// ---- Keys ----
const used = computed(() => [...new Set([draft.value.listen.service, draft.value.speak.service])].filter(s => s !== 'browser').map(s => voiceService(s)!))
const keyInputs = ref<Record<string, string>>({})
const savingKey = ref<string | null>(null)
const savedKey = (id: string) => voice.keys.value.find(k => k.service === id)
async function saveKey(id: VoiceService) {
  const key = (keyInputs.value[id] || '').trim()
  if (!key) return
  savingKey.value = id
  try {
    await voice.saveKey(id, key)
    keyInputs.value[id] = ''
    toast.add({ title: 'Key saved', description: 'Use Test voice to check it works.', icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not save the key', description: errorText(e, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    savingKey.value = null
  }
}
async function removeKey(id: VoiceService) {
  try { await voice.removeKey(id) } catch (e: any) { toast.add({ title: 'Could not remove the key', description: errorText(e, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' }) }
}

// ---- Test ----
const testing = ref(false)
let playing: Playback | null = null
async function test() {
  if (testing.value) { playing?.stop(); return }
  testing.value = true
  const sample = "Hello, I'm Lobby. This is how I'll sound when I tell you what I'm working on."
  try {
    if (draft.value.speak.service === 'browser') playing = speakInBrowser(sample, { rate: draft.value.speed, voiceURI: voice.browserVoice.value })
    else playing = playUrl(await fetchSpeech(sample))
    await playing.done
  } catch (e: any) {
    toast.add({ title: 'The voice did not work', description: errorText(e, 'Check the key and try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    playing = null
    testing.value = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-default bg-default p-4 sm:p-5 flex flex-col gap-6">
    <p class="text-sm text-muted">
      Lobby is the voice of OpenLobs: say what you want, and it tells you what it is doing as it works. The free browser voice works with no setup. Pick a better voice any time, and switch back whenever you like.
    </p>

    <p
      v-if="voice.error.value && !voice.loaded.value"
      class="text-sm text-muted"
    >
      {{ voice.error.value }}
    </p>

    <!-- Listening -->
    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Lobby listens with
      </h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Service">
          <USelect
            :model-value="draft.listen.service"
            :items="serviceItems(listeners)"
            class="w-full"
            @update:model-value="setListenService($event as VoiceService)"
          />
        </UFormField>
        <UFormField
          v-if="listenDef.id !== 'browser'"
          label="Model"
        >
          <USelect
            :model-value="draft.listen.model"
            :items="choiceItems(listenDef.listen)"
            class="w-full"
            @update:model-value="setListenModel($event as string)"
          />
        </UFormField>
      </div>
      <p class="text-xs text-muted">
        {{ listenDef.note }}
      </p>
    </div>

    <!-- Speaking -->
    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Lobby speaks with
      </h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Service">
          <USelect
            :model-value="draft.speak.service"
            :items="serviceItems(speakers)"
            class="w-full"
            @update:model-value="setSpeakService($event as VoiceService)"
          />
        </UFormField>
        <UFormField
          v-if="speakDef.id !== 'browser'"
          label="Model"
        >
          <USelect
            :model-value="draft.speak.model"
            :items="choiceItems(speakDef.speak)"
            class="w-full"
            @update:model-value="setSpeakModel($event as string)"
          />
        </UFormField>
        <UFormField
          v-if="speakDef.id !== 'browser'"
          label="Voice"
          :hint="`${speakDef.voices.length} to choose from`"
        >
          <USelect
            :model-value="voiceIsListed ? draft.speak.voice : undefined"
            :items="choiceItems(speakDef.voices)"
            :placeholder="voiceIsListed ? undefined : `Your own: ${draft.speak.voice}`"
            class="w-full"
            @update:model-value="setVoice($event as string)"
          />
        </UFormField>
        <UFormField
          v-else
          label="Voice on this device"
          :hint="deviceVoices.length ? `${deviceVoices.length} on this device` : undefined"
        >
          <USelect
            :model-value="voice.browserVoice.value || BEST"
            :items="deviceItems"
            class="w-full"
            @update:model-value="voice.chooseBrowserVoice($event === BEST ? '' : $event as string)"
          />
        </UFormField>
      </div>

      <form
        v-if="speakDef.customVoice"
        class="flex flex-col sm:flex-row gap-2 sm:items-end"
        @submit.prevent="useCustomVoice"
      >
        <UFormField
          label="Or use any voice id from your library"
          class="flex-1"
        >
          <UInput
            v-model="customVoice"
            class="w-full"
            placeholder="Paste a voice id"
            autocomplete="off"
            :maxlength="VOICE_LIMITS.customVoiceMax"
          />
        </UFormField>
        <UButton
          type="submit"
          label="Use it"
          color="neutral"
          :disabled="!customVoice.trim()"
        />
      </form>
      <p class="text-xs text-muted">
        {{ speakDef.note }}
      </p>

      <UFormField :label="`Speed: ${draft.speed.toFixed(1)}x`">
        <USlider
          v-model="speed"
          :min="VOICE_LIMITS.speedMin"
          :max="VOICE_LIMITS.speedMax"
          :step="0.05"
          @update:model-value="setSpeed($event as number)"
        />
      </UFormField>
    </div>

    <!-- Keys -->
    <div
      v-if="used.length"
      class="flex flex-col gap-3"
    >
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Keys
      </h3>
      <div
        v-for="s in used"
        :key="s.id"
        class="rounded-xl border border-default bg-elevated/40 p-3 flex flex-col gap-2.5"
      >
        <div class="flex items-center gap-2">
          <UIcon
            :name="s.icon"
            class="size-4"
          />
          <p class="text-sm font-medium text-highlighted">
            {{ s.name }}
          </p>
          <UBadge
            v-if="savedKey(s.id)"
            :label="`Key ending ${savedKey(s.id)!.last4}`"
            color="success"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-else-if="voice.fromChat.value[s.id]"
            label="Using your chat key"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-else
            label="No key yet"
            color="warning"
            variant="subtle"
            size="sm"
          />
          <UButton
            v-if="savedKey(s.id)"
            label="Remove"
            color="neutral"
            variant="ghost"
            size="xs"
            class="ml-auto"
            @click="removeKey(s.id)"
          />
        </div>
        <p class="text-xs text-muted">
          {{ s.keyHelp }}
          <a
            :href="s.keyUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline-offset-2 hover:underline"
          >Get a key</a>
        </p>
        <form
          class="flex gap-2"
          @submit.prevent="saveKey(s.id)"
        >
          <UInput
            v-model="keyInputs[s.id]"
            type="password"
            class="flex-1"
            :placeholder="savedKey(s.id) ? 'Paste a new key to replace it' : 'Paste your key'"
            autocomplete="off"
            :aria-label="`${s.name} key`"
          />
          <UButton
            type="submit"
            label="Save"
            color="neutral"
            :loading="savingKey === s.id"
            :disabled="!(keyInputs[s.id] || '').trim()"
          />
        </form>
      </div>
      <p class="text-xs text-muted">
        Keys are stored sealed and never shown again. The cost of using them is billed by the service to your own account.
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
      <USwitch
        :model-value="draft.keepListening"
        label="Keep listening after I'm answered"
        description="Hands-free: it listens again by itself, so you can just keep talking."
        @update:model-value="setKeep($event)"
      />
      <UButton
        :label="testing ? 'Stop' : 'Test voice'"
        :icon="testing ? 'i-lucide-square' : 'i-lucide-play'"
        color="neutral"
        variant="subtle"
        @click="test"
      />
    </div>
  </div>
</template>
