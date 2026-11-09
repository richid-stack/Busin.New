<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useReefList } from '../../composables/useReefList'
import { useReefMe } from '../../composables/useReefMe'
import { useReefUi } from '../../composables/useReefUi'
import { KINDS } from '../../utils/reefKinds'
import { fmt, shortAgo } from '../../utils/reefTime'
import type { ProjectCard } from '../../types/reef'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefSkeleton from '../../components/reef/ReefSkeleton.vue'
import ReefState from '../../components/reef/ReefState.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Projects · The Reef' })

const route = useRoute()
const router = useRouter()
const api = useReef()
const { requireProfile } = useReefMe()
const { openPublish } = useReefUi()

const q = ref(String(route.query.q ?? ''))
const tag = ref(String(route.query.tag ?? ''))
const sort = ref<'new' | 'stars'>('stars')
const SORTS = [{ id: 'stars', label: 'Most starred' }, { id: 'new', label: 'Newest' }] as const

const list = useReefList<ProjectCard & { id?: string }>(async (before) => {
  const res = await api.projects({ sort: sort.value, q: q.value.trim(), tag: tag.value, before })
  return { items: res.items.map(p => ({ ...p, id: `${p.owner}/${p.name}` })), next: res.next }
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(() => { void router.replace({ query: { ...(q.value.trim() ? { q: q.value.trim() } : {}), ...(tag.value ? { tag: tag.value } : {}) } }); void list.load() }, 300)
})
watch(sort, () => { void list.load() })
watch(() => route.query.tag, (t) => { tag.value = String(t ?? ''); void list.load() })
onMounted(() => { void list.load() })

const clearTag = () => { void router.replace({ query: q.value.trim() ? { q: q.value.trim() } : {} }) }
const share = () => { if (requireProfile(() => openPublish())) openPublish() }
</script>

<template>
  <ReefShell title="Projects">
    <template #action><UButton label="Share" icon="i-lucide-plus" size="sm" color="neutral" class="rounded-full" @click="share" /></template>
    <template #header>
      <div class="px-4 pb-3 space-y-3">
        <div class="flex items-center gap-2 rounded-full bg-elevated px-4 py-2.5 text-muted focus-within:ring-2 focus-within:ring-primary">
          <UIcon name="i-lucide-search" class="size-4" />
          <input v-model="q" class="bg-transparent outline-none text-sm w-full placeholder:text-dimmed" placeholder="Search by name or what it does" aria-label="Search projects" maxlength="60">
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
          <button v-for="s in SORTS" :key="s.id" type="button" class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors" :class="sort === s.id ? 'border-transparent bg-inverted text-inverted' : 'border-default text-muted hover:bg-elevated'" :aria-pressed="sort === s.id" @click="sort = s.id">{{ s.label }}</button>
          <button v-if="tag" type="button" class="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-sm text-primary" @click="clearTag">{{ tag }}<UIcon name="i-lucide-x" class="size-3.5" /><span class="sr-only">Clear the tag filter</span></button>
        </div>
      </div>
    </template>

    <ReefSkeleton v-if="list.loading.value" :rows="4" />
    <ReefState v-else-if="list.error.value" tone="error" icon="i-lucide-cloud-off" title="Could not load projects" :text="list.error.value"><UButton label="Try again" color="neutral" variant="outline" @click="list.load()" /></ReefState>
    <template v-else-if="list.items.value.length">
      <article v-for="p in list.items.value" :key="`${p.owner}/${p.name}`" class="px-4 py-4 border-b border-default hover:bg-elevated/30 transition-colors">
        <RouterLink :to="`/reef/${p.owner}/${p.name}`" class="flex items-center gap-2 min-w-0">
          <UIcon :name="KINDS[p.kind].icon" class="size-4 shrink-0" :class="KINDS[p.kind].text" />
          <span class="text-primary font-semibold truncate hover:underline"><span class="font-normal">{{ p.owner }} /</span> {{ p.name }}</span>
          <UBadge :label="KINDS[p.kind].label" color="neutral" variant="outline" size="sm" class="ml-1 shrink-0" />
          <UBadge v-if="p.safety === 'review'" label="Read carefully" color="warning" variant="subtle" size="sm" class="shrink-0" />
        </RouterLink>
        <p v-if="p.description" class="text-sm text-muted mt-1.5 max-w-xl">{{ p.description }}</p>
        <div v-if="p.tags.length" class="flex flex-wrap gap-1.5 mt-2.5"><RouterLink v-for="t in p.tags" :key="t" :to="`/reef/projects?tag=${t}`"><UBadge :label="t" color="primary" variant="subtle" size="sm" /></RouterLink></div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted">
          <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-star" class="size-3.5" />{{ fmt(p.stars) }}</span>
          <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-git-fork" class="size-3.5" />{{ fmt(p.forks) }}</span>
          <span>{{ p.licence.short }}</span>
          <span>Updated {{ shortAgo(p.updatedAt) }}</span>
        </div>
      </article>
      <div v-if="list.next.value" class="p-4 flex justify-center"><UButton label="Show more" color="neutral" variant="outline" :loading="list.loadingMore.value" @click="list.more()" /></div>
    </template>
    <ReefState v-else-if="q.trim() || tag" icon="i-lucide-search-x" title="Nothing matches" text="Try another word, or clear the filter." />
    <ReefState v-else icon="i-lucide-boxes" title="No projects yet" text="Share the first agent. Others can read it, star it, fork it and add it to their own OpenLobs.">
      <UButton label="Share a project" color="neutral" @click="share" />
    </ReefState>
  </ReefShell>
</template>
