<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { KINDS, PROJECTS, fmt } from '../../reef/concept'
import type { ProjectKind } from '../../reef/concept'
import ReefShell from '../../components/reef/ReefShell.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Projects · The Reef' })

const kind = ref<ProjectKind | 'all'>('all')
const FILTERS: Array<{ value: ProjectKind | 'all', label: string }> = [{ value: 'all', label: 'All' }, ...(Object.keys(KINDS) as ProjectKind[]).map(k => ({ value: k, label: KINDS[k].label + 's' }))]
const list = computed(() => PROJECTS.filter(p => kind.value === 'all' || p.kind === kind.value).sort((a, b) => b.stars - a.stars))
</script>

<template>
  <ReefShell title="Projects">
    <template #header>
      <div class="px-4 pb-3 space-y-3">
        <div class="flex items-center gap-2 rounded-full bg-elevated px-4 py-2.5 text-muted focus-within:ring-2 focus-within:ring-primary">
          <UIcon name="i-lucide-search" class="size-4" />
          <input class="bg-transparent outline-none text-sm w-full placeholder:text-dimmed" placeholder="Search agents, workflows, tasks and packs" aria-label="Search projects">
        </div>
        <div class="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          <button v-for="f in FILTERS" :key="f.value" type="button" class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors" :class="kind === f.value ? 'border-transparent bg-inverted text-inverted' : 'border-default text-muted hover:bg-elevated'" :aria-pressed="kind === f.value" @click="kind = f.value">{{ f.label }}</button>
        </div>
      </div>
    </template>

    <article v-for="p in list" :key="p.name" class="px-4 py-4 border-b border-default hover:bg-elevated/30 transition-colors">
      <RouterLink :to="`/reef/${p.owner}/${p.name}`" class="flex items-center gap-2 min-w-0">
        <UIcon :name="KINDS[p.kind].icon" class="size-4 shrink-0" :class="KINDS[p.kind].text" />
        <span class="text-primary font-semibold truncate hover:underline"><span class="font-normal">{{ p.owner }} /</span> {{ p.name }}</span>
        <UBadge :label="KINDS[p.kind].label" color="neutral" variant="outline" size="sm" class="ml-1 shrink-0" />
      </RouterLink>
      <p class="text-sm text-muted mt-1.5 max-w-xl">{{ p.blurb }}</p>
      <div class="flex flex-wrap gap-1.5 mt-2.5"><UBadge v-for="t in p.tags" :key="t" :label="t" color="primary" variant="subtle" size="sm" /></div>
      <div class="flex items-center gap-4 mt-3 text-xs text-muted">
        <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-star" class="size-3.5" />{{ fmt(p.stars) }}</span>
        <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-git-fork" class="size-3.5" />{{ fmt(p.forks) }}</span>
        <span>{{ p.licence }}</span>
        <span>Updated {{ p.updated }}</span>
      </div>
    </article>
  </ReefShell>
</template>
