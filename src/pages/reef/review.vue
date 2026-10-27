<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { shortAgo } from '../../utils/reefTime'
import type { QueueItem } from '../../types/reef'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefSkeleton from '../../components/reef/ReefSkeleton.vue'
import ReefState from '../../components/reef/ReefState.vue'
import ModalConfirm from '../../components/ModalConfirm.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Review · The Reef' })

const api = useReef()
const toast = useToast()
const overlay = useOverlay()
const { admin, loaded } = useReefMe()

const items = ref<QueueItem[]>([])
const loading = ref(true)
const error = ref('')
const working = ref<string | null>(null)

const REASONS: Record<string, string> = { secret: 'Key or password', harmful: 'Harmful or hidden', spam: 'Spam or scam', other: 'Something else' }
const keyOf = (i: QueueItem) => `${i.targetType}:${i.targetId}`
const link = (i: QueueItem) => (i.targetType === 'project' ? `/reef/${i.targetId}` : `/reef/post/${i.targetId}`)

async function load() {
  loading.value = true
  error.value = ''
  try { items.value = (await api.queue()).items } catch (err: any) { error.value = err?.message || 'Could not load the queue.' } finally { loading.value = false }
}
// Wait until we know who the person is, so a slow sign-in is not shown as "not allowed".
watch([loaded, admin], ([isLoaded, isAdmin]) => {
  if (!isLoaded) return
  if (isAdmin) void load()
  else loading.value = false
}, { immediate: true })

const confirm = overlay.create(ModalConfirm)
async function act(i: QueueItem, action: 'restore' | 'remove') {
  if (action === 'remove') {
    const ok = await confirm.open({ title: 'Take it down?', description: `${i.targetType === 'project' ? 'The project and its versions' : 'The post and its replies'} are deleted for good.`, confirmLabel: 'Take down' }).result
    if (!ok) return
  }
  working.value = keyOf(i)
  try {
    await api.resolve({ targetType: i.targetType, targetId: i.targetId, action })
    items.value = items.value.filter(x => keyOf(x) !== keyOf(i))
    toast.add({ title: action === 'restore' ? 'Put back' : 'Taken down', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not do that', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    working.value = null
  }
}
const denied = computed(() => loaded.value && !admin.value)
</script>

<template>
  <ReefShell title="Review">
    <ReefState v-if="denied" icon="i-lucide-lock" title="Only the people who run The Reef can see this" />
    <ReefSkeleton v-else-if="loading" :rows="3" />
    <ReefState v-else-if="error" tone="error" icon="i-lucide-cloud-off" title="Could not load the queue" :text="error"><UButton label="Try again" color="neutral" variant="outline" @click="load" /></ReefState>
    <ul v-else-if="items.length">
      <li v-for="i in items" :key="keyOf(i)" class="px-4 py-4 border-b border-default">
        <div class="flex items-start gap-3">
          <UIcon :name="i.targetType === 'project' ? 'i-lucide-boxes' : 'i-lucide-message-square'" class="size-5 mt-0.5 text-muted shrink-0" />
          <div class="min-w-0 flex-1">
            <RouterLink :to="link(i)" class="font-semibold text-highlighted hover:underline break-all">{{ i.targetType === 'project' ? i.targetId : 'Post' }}</RouterLink>
            <p class="text-xs text-muted mt-0.5">{{ i.reports }} {{ i.reports === 1 ? 'report' : 'reports' }} · first {{ shortAgo(i.firstReportedAt) }} ago<template v-if="i.hidden"> · hidden from everyone</template></p>
            <div class="flex flex-wrap gap-1.5 mt-2"><UBadge v-for="r in i.reasons" :key="r" :label="REASONS[r] ?? r" color="warning" variant="subtle" size="sm" /><UBadge v-if="i.flagged" label="Flagged by the check" color="error" variant="subtle" size="sm" /></div>
            <ul v-if="i.notes.length" class="mt-2 space-y-1"><li v-for="(n, k) in i.notes" :key="k" class="text-sm text-muted border-l-2 border-default pl-3 whitespace-pre-wrap break-words">{{ n }}</li></ul>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-3">
          <UButton label="Put back" color="neutral" variant="outline" size="sm" :disabled="working === keyOf(i)" @click="act(i, 'restore')" />
          <UButton label="Take down" color="error" variant="soft" size="sm" :loading="working === keyOf(i)" @click="act(i, 'remove')" />
        </div>
      </li>
    </ul>
    <ReefState v-else icon="i-lucide-shield-check" title="Nothing to review" text="Reported projects and posts show up here." />
  </ReefShell>
</template>
