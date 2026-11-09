<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ReefApiError, useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { useReefUi } from '../../composables/useReefUi'
import type { ReefScan } from '../../types/reef'
import ReefFindings from './ReefFindings.vue'

const open = defineModel<boolean>('open', { default: false })
const router = useRouter()
const api = useReef()
const { requireProfile } = useReefMe()
const { askProject } = useReefUi()

const title = ref('')
const text = ref('')
const tags = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const blocked = ref<ReefScan | null>(null)
watch(open, (o) => { if (o) { error.value = null; blocked.value = null } })

async function submit() {
  if (title.value.trim().length < 8 || busy.value) return
  if (!requireProfile(() => { open.value = true })) { open.value = false; return }
  busy.value = true
  error.value = null
  blocked.value = null
  try {
    const q = await api.ask({ title: title.value.trim(), text: text.value.trim(), tags: tags.value.split(',').map(t => t.trim()).filter(Boolean), projectId: askProject.value })
    open.value = false
    title.value = ''; text.value = ''; tags.value = ''
    await router.push(`/reef/post/${q.id}`)
  } catch (err: any) {
    if (err instanceof ReefApiError && err.scan) { blocked.value = err.scan; error.value = err.message } else error.value = err?.message || 'Could not post your question.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Ask a question" description="Be specific. People answer faster when they can see what you tried." :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Your question" required :help="`${140 - title.length} characters left`">
          <UInput v-model="title" class="w-full" maxlength="140" placeholder="How do I connect Paystack to a workflow?" />
        </UFormField>
        <UFormField label="Details" help="What you tried, and what happened. Never paste a key or password.">
          <UTextarea v-model="text" class="w-full" :rows="5" maxlength="2000" />
        </UFormField>
        <UFormField label="Tags" help="Up to four, separated by commas.">
          <UInput v-model="tags" class="w-full" placeholder="paystack, workflows" />
        </UFormField>
        <ReefFindings v-if="blocked" :scan="blocked" mode="blocked" />
        <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Post question" color="neutral" :loading="busy" :disabled="title.trim().length < 8" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
