<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { postPath } from '../../composables/useReef'
import { shortAgo } from '../../utils/reefTime'
import type { ReefAlert } from '../../types/reef'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefAvatar from '../../components/reef/ReefAvatar.vue'
import ReefSkeleton from '../../components/reef/ReefSkeleton.vue'
import ReefState from '../../components/reef/ReefState.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Alerts · The Reef' })

const api = useReef()
const { signedIn, clearUnread } = useReefMe()
const { openAuthModal } = useFirebaseAuth()

const items = ref<ReefAlert[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const WHAT: Record<ReefAlert['type'], { icon: string, text: string, tone: string }> = {
  follow: { icon: 'i-lucide-user-plus', text: 'followed you', tone: 'text-sky-500' },
  star: { icon: 'i-lucide-star', text: 'starred', tone: 'text-amber-500' },
  like: { icon: 'i-lucide-heart', text: 'liked your post', tone: 'text-rose-500' },
  reply: { icon: 'i-lucide-message-circle', text: 'replied to your post', tone: 'text-sky-500' },
  answer: { icon: 'i-lucide-message-square-reply', text: 'answered your question', tone: 'text-emerald-500' },
  fork: { icon: 'i-lucide-git-fork', text: 'forked', tone: 'text-violet-500' },
  accepted: { icon: 'i-lucide-circle-check', text: 'marked your answer as the one that worked', tone: 'text-success' }
}
const to = (a: ReefAlert) => (a.targetType === 'profile' ? `/reef/u/${a.actor.handle}` : a.targetType === 'project' ? `/reef/${a.targetId}` : postPath(a.targetId))

async function load() {
  if (!signedIn.value) { loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    items.value = (await api.alerts()).items
    // Seeing them is what reads them. Marked after they are on screen so the unread dots show once.
    if (items.value.some(a => !a.read)) {
      await api.readAlerts().catch(() => {})
      clearUnread()
    }
  } catch (err: any) {
    error.value = err?.message || 'Could not load alerts.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
// Sign-in can finish after the page opens (the saved session is restored a moment late).
watch(signedIn, () => { void load() })
</script>

<template>
  <ReefShell title="Alerts">
    <ReefState v-if="!signedIn" icon="i-lucide-bell" title="Sign in to see your alerts" text="You hear about new followers, stars, replies and answers here.">
      <UButton label="Sign in" color="neutral" @click="openAuthModal()" />
    </ReefState>
    <ReefSkeleton v-else-if="loading" :rows="5" />
    <ReefState v-else-if="error" tone="error" icon="i-lucide-cloud-off" title="Could not load alerts" :text="error"><UButton label="Try again" color="neutral" variant="outline" @click="load" /></ReefState>
    <ul v-else-if="items.length">
      <li v-for="a in items" :key="a.id">
        <RouterLink :to="to(a)" class="flex gap-3 px-4 py-3.5 border-b border-default hover:bg-elevated/30 transition-colors" :class="a.read ? '' : 'bg-primary/5'">
          <UIcon :name="WHAT[a.type].icon" class="size-5 mt-1 shrink-0" :class="WHAT[a.type].tone" />
          <div class="min-w-0 flex-1">
            <ReefAvatar :name="a.actor.name" :size="28" />
            <p class="mt-1.5 text-[15px] text-default"><b class="text-highlighted">{{ a.actor.name }}</b> {{ WHAT[a.type].text }}<template v-if="a.type === 'star' || a.type === 'fork'">{{ ' ' }}<b class="text-highlighted">{{ a.targetId }}</b></template></p>
            <p v-if="a.preview" class="mt-1 text-sm text-muted line-clamp-2">{{ a.preview }}</p>
          </div>
          <span class="text-xs text-dimmed shrink-0">{{ shortAgo(a.createdAt) }}</span>
        </RouterLink>
      </li>
    </ul>
    <ReefState v-else icon="i-lucide-bell" title="Nothing yet" text="When someone follows you, stars your project or answers your question, it shows up here." />
  </ReefShell>
</template>
