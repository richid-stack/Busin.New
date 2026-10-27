<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useReefList } from '../../composables/useReefList'
import { useReefMe } from '../../composables/useReefMe'
import { useReefUi } from '../../composables/useReefUi'
import { shortAgo } from '../../utils/reefTime'
import type { PostView } from '../../types/reef'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefAvatar from '../../components/reef/ReefAvatar.vue'
import ReefSkeleton from '../../components/reef/ReefSkeleton.vue'
import ReefState from '../../components/reef/ReefState.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Questions · The Reef' })

const api = useReef()
const { requireProfile } = useReefMe()
const { openAsk } = useReefUi()

const TABS = [{ id: 'new', label: 'Newest' }, { id: 'unanswered', label: 'Unanswered' }, { id: 'solved', label: 'Solved' }] as const
const tab = ref<typeof TABS[number]['id']>('new')
const list = useReefList<PostView>(before => api.questions({ filter: tab.value, before }))
onMounted(() => { void list.load() })
watch(tab, () => { void list.load() })

const ask = () => { if (requireProfile(() => openAsk())) openAsk() }
</script>

<template>
  <ReefShell title="Questions">
    <template #action><UButton label="Ask a question" icon="i-lucide-plus" size="sm" color="neutral" class="rounded-full" @click="ask" /></template>
    <template #header>
      <div class="flex" role="tablist">
        <button v-for="t in TABS" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t.id ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t.id">
          {{ t.label }}
          <span v-if="tab === t.id" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-14 rounded-full bg-primary" />
        </button>
      </div>
    </template>

    <ReefSkeleton v-if="list.loading.value" :rows="5" />
    <ReefState v-else-if="list.error.value" tone="error" icon="i-lucide-cloud-off" title="Could not load questions" :text="list.error.value"><UButton label="Try again" color="neutral" variant="outline" @click="list.load()" /></ReefState>
    <ul v-else-if="list.items.value.length">
      <li v-for="q in list.items.value" :key="q.id">
        <RouterLink :to="`/reef/post/${q.id}`" class="flex gap-3 px-4 py-3.5 border-b border-default hover:bg-elevated/30 transition-colors">
          <div class="w-[58px] shrink-0 rounded-lg border px-1 py-1.5 text-center" :class="q.accepted ? 'border-success/40 bg-success/10 text-success' : 'border-default text-muted'">
            <p class="text-base font-semibold leading-none" :class="q.accepted ? '' : q.replies ? 'text-highlighted' : ''">{{ q.replies }}</p>
            <p class="text-[10px] mt-1 leading-none">{{ q.accepted ? 'solved' : q.replies === 1 ? 'answer' : 'answers' }}</p>
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-highlighted leading-snug">{{ q.title }}</p>
            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span v-for="t in q.tags" :key="t" class="text-xs rounded-md bg-elevated px-2 py-0.5 text-muted">{{ t }}</span>
              <span v-if="q.project" class="text-xs text-primary">{{ q.project.owner }}/{{ q.project.name }}</span>
            </div>
            <p class="mt-2 flex items-center gap-1.5 text-xs text-muted"><ReefAvatar :name="q.author.name" :size="16" />{{ q.author.name }} asked {{ shortAgo(q.createdAt) }}</p>
          </div>
        </RouterLink>
      </li>
      <li v-if="list.next.value" class="p-4 flex justify-center"><UButton label="Show more" color="neutral" variant="outline" :loading="list.loadingMore.value" @click="list.more()" /></li>
    </ul>
    <ReefState v-else icon="i-lucide-circle-help" :title="tab === 'new' ? 'No questions yet' : tab === 'unanswered' ? 'Every question has an answer' : 'Nothing solved yet'" :text="tab === 'new' ? 'Be the first to ask. Someone who has been through it will answer.' : 'Come back later, or answer one in the Newest tab.'">
      <UButton v-if="tab === 'new'" label="Ask a question" color="neutral" @click="ask" />
    </ReefState>
  </ReefShell>
</template>
