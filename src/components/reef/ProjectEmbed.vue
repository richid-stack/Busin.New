<script setup lang="ts">
import { KINDS, NEED_ICONS } from '../../utils/reefKinds'
import { fmt } from '../../utils/reefTime'
import type { ProjectCard } from '../../types/reef'

defineProps<{ project: ProjectCard }>()
</script>

<template>
  <RouterLink
    :to="`/reef/${project.owner}/${project.name}`"
    class="block rounded-2xl border border-default p-3.5 hover:bg-elevated/50 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
    @click.stop
  >
    <div class="flex items-center gap-2 text-sm min-w-0">
      <UIcon :name="KINDS[project.kind].icon" class="size-4 shrink-0" :class="KINDS[project.kind].text" />
      <span class="truncate"><span class="text-muted">{{ project.owner }} /</span> <span class="font-semibold text-highlighted">{{ project.name }}</span></span>
      <span class="ml-auto text-xs text-dimmed shrink-0">{{ KINDS[project.kind].label }}</span>
    </div>
    <p v-if="project.description" class="text-sm text-muted mt-1.5 line-clamp-2">{{ project.description }}</p>
    <div class="flex items-center gap-4 mt-3 text-xs text-muted">
      <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-star" class="size-3.5" />{{ fmt(project.stars) }}</span>
      <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-git-fork" class="size-3.5" />{{ fmt(project.forks) }}</span>
      <span v-if="project.works.length" class="ml-auto flex items-center -space-x-1">
        <span v-for="w in project.works.slice(0, 4)" :key="w.id" class="size-5 rounded-full bg-default border border-default flex items-center justify-center" :title="w.label"><UIcon :name="NEED_ICONS[w.id] ?? 'i-lucide-puzzle'" class="size-3" /></span>
      </span>
    </div>
  </RouterLink>
</template>
