<script setup lang="ts">
import { KINDS, fmt } from '../../reef/concept'
import type { Project } from '../../reef/concept'

defineProps<{ project: Project }>()
</script>

<template>
  <RouterLink
    :to="`/reef/${project.owner}/${project.name}`"
    class="block rounded-2xl border border-default p-3.5 hover:bg-elevated/50 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
  >
    <div class="flex items-center gap-2 text-sm min-w-0">
      <UIcon :name="KINDS[project.kind].icon" class="size-4 shrink-0" :class="KINDS[project.kind].text" />
      <span class="truncate"><span class="text-muted">{{ project.owner }} /</span> <span class="font-semibold text-highlighted">{{ project.name }}</span></span>
      <span class="ml-auto text-xs text-dimmed shrink-0">{{ KINDS[project.kind].label }}</span>
    </div>
    <p class="text-sm text-muted mt-1.5 line-clamp-2">{{ project.blurb }}</p>
    <div class="flex items-center gap-4 mt-3 text-xs text-muted">
      <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-star" class="size-3.5" />{{ fmt(project.stars) }}</span>
      <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-git-fork" class="size-3.5" />{{ fmt(project.forks) }}</span>
      <span class="ml-auto flex items-center -space-x-1">
        <span v-for="u in project.uses" :key="u.app" class="size-5 rounded-full bg-default border border-default flex items-center justify-center" :title="u.app"><UIcon :name="u.icon" class="size-3" /></span>
      </span>
    </div>
  </RouterLink>
</template>
