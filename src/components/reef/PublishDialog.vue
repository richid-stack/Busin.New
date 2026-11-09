<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ReefApiError, useReef } from '../../composables/useReef'
import { useAgents } from '../../composables/useAgents'
import { useReefMe } from '../../composables/useReefMe'
import { LICENCES } from '../../types/reef'
import type { LicenceId, ReefScan } from '../../types/reef'
import type { AgentProfile } from '../../types/agents'
import ReefFindings from './ReefFindings.vue'

const props = defineProps<{ agent?: AgentProfile | null, /** Publish a new version of this project. */ presetName?: string | null }>()
const open = defineModel<boolean>('open', { default: false })

const router = useRouter()
const toast = useToast()
const api = useReef()
const { agents, loaded, fetchAgents } = useAgents()
const { profile, requireProfile } = useReefMe()

const agentId = ref('')
const name = ref('')
const nameTouched = ref(false)
const description = ref('')
const tags = ref('')
const licence = ref<LicenceId>('cc-by-4.0')
const readme = ref('')
const note = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const blocked = ref<ReefScan | null>(null)

const picked = computed(() => agents.value.find(a => a.id === agentId.value) ?? null)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const nameOk = computed(() => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name.value))

function fill(a: AgentProfile | null) {
  if (!a) return
  if (!nameTouched.value) name.value = slug(a.name)
  description.value = a.description || ''
  readme.value = `# ${a.name}\n\n${a.description || 'What it is for, in a sentence or two.'}\n\n## What it does\n\n- \n\n## Set it up\n\n- Add it to your OpenLobs with the button on this page\n- Connect the apps it needs (listed under Needs)\n\n## Good to know\n\nAnything that sends a message or changes a file asks for your OK first.\n`
}

watch(open, async (o) => {
  if (!o) return
  error.value = null
  blocked.value = null
  nameTouched.value = false
  note.value = ''
  tags.value = ''
  licence.value = 'cc-by-4.0'
  if (!loaded.value) await fetchAgents()
  agentId.value = props.agent?.id ?? agents.value[0]?.id ?? ''
  if (props.presetName) { name.value = props.presetName; nameTouched.value = true }
  fill(picked.value)
  // A new version starts from what the project says now, not from a blank template.
  if (props.presetName && profile.value) {
    try {
      const current = await api.project(profile.value.handle, props.presetName)
      description.value = current.description
      readme.value = current.readme
      tags.value = current.tags.join(', ')
      licence.value = current.licence.id
    } catch { /* keep the template */ }
  }
})
watch(agentId, () => { if (open.value) fill(picked.value) })

const licenceDetail = computed(() => LICENCES.find(l => l.id === licence.value)?.detail ?? '')

async function submit() {
  if (!picked.value || !nameOk.value || busy.value) return
  if (!requireProfile(() => { open.value = true })) { open.value = false; return }
  busy.value = true
  error.value = null
  blocked.value = null
  try {
    const { created, project } = await api.publish({
      agentId: picked.value.id,
      name: name.value,
      description: description.value.trim(),
      tags: tags.value.split(',').map(t => t.trim()).filter(Boolean),
      licence: licence.value,
      readme: readme.value,
      note: note.value.trim()
    })
    open.value = false
    toast.add({ title: created ? 'Shared to The Reef' : `Published version ${project.version}`, icon: 'i-lucide-check', color: 'success' })
    await router.push(`/reef/${project.owner}/${project.name}`)
  } catch (err: any) {
    if (err instanceof ReefApiError && err.scan) { blocked.value = err.scan; error.value = err.message } else error.value = err?.message || 'Could not share. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Share a project" description="Share one of your agents with The Reef. It is checked first for keys, hidden text and look-alike links." :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div v-if="!loaded" class="py-10 flex justify-center"><UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" /></div>

      <div v-else-if="!agents.length" class="py-8 text-center">
        <p class="text-sm font-semibold text-highlighted">You have no agents yet</p>
        <p class="text-sm text-muted mt-1">Make an agent first, then come back to share it.</p>
        <UButton class="mt-4" label="Make an agent" to="/agents" color="neutral" @click="open = false" />
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <UFormField label="Agent to share" required>
          <USelectMenu v-model="agentId" :items="agents.map(a => ({ label: a.name, value: a.id }))" value-key="value" class="w-full" />
        </UFormField>
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField label="Project name" required :help="profile ? `Address: /reef/${profile.handle}/${name || 'name'}. Using a name you already shared publishes a new version.` : 'Letters, numbers and dashes.'" :error="name && !nameOk ? 'Use letters, numbers and dashes, up to 40.' : undefined">
            <UInput v-model="name" class="w-full" maxlength="40" placeholder="shop-assistant" autocapitalize="none" spellcheck="false" :disabled="Boolean(presetName)" @update:model-value="nameTouched = true" />
          </UFormField>
          <UFormField label="Tags" help="Up to five, separated by commas.">
            <UInput v-model="tags" class="w-full" placeholder="retail, mobile-money, ghana" />
          </UFormField>
        </div>
        <UFormField label="Short description" :help="`${240 - description.length} characters left`">
          <UTextarea v-model="description" class="w-full" :rows="2" maxlength="240" />
        </UFormField>
        <UFormField label="README" help="Tell people what it does and how to set it up. Markdown works.">
          <UTextarea v-model="readme" class="w-full font-mono text-[13px]" :rows="9" maxlength="20000" />
        </UFormField>
        <UFormField label="What changed" help="A short note for the version history. Optional for a first version.">
          <UInput v-model="note" class="w-full" maxlength="120" placeholder="First release" />
        </UFormField>
        <UFormField label="Licence" :help="licenceDetail">
          <URadioGroup v-model="licence" :items="LICENCES.map(l => ({ label: l.label, value: l.id }))" value-key="value" />
        </UFormField>

        <div class="rounded-xl border border-default p-3.5 text-sm">
          <p class="font-medium text-highlighted mb-1.5">What is shared</p>
          <p class="text-muted">The name, description, instructions in full, which tools and skills it uses, and your README. <b class="text-default">Never</b> the model or any key, your chats and memory, or your connected apps.</p>
        </div>

        <ReefFindings v-if="blocked" :scan="blocked" mode="blocked" />
        <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Share" icon="i-lucide-waves" color="neutral" :loading="busy" :disabled="!picked || !nameOk" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
