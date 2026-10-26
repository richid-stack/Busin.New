<script setup lang="ts">
import { computed } from 'vue'
import { PEOPLE, fmt, project as findProject } from '../../reef/concept'
import type { Post } from '../../reef/concept'
import ReefAvatar from './ReefAvatar.vue'
import ReefName from './ReefName.vue'
import ProjectEmbed from './ProjectEmbed.vue'

const props = defineProps<{ post: Post }>()
const person = computed(() => PEOPLE[props.post.by]!)
const embedded = computed(() => {
  if (!props.post.project) return undefined
  const [o, n] = props.post.project.split('/')
  return findProject(o!, n!)
})

const ACTIONS = [
  { key: 'replies', icon: 'i-lucide-message-circle', hover: 'hover:text-sky-500 hover:bg-sky-500/10', label: 'Reply' },
  { key: 'reposts', icon: 'i-lucide-repeat-2', hover: 'hover:text-emerald-500 hover:bg-emerald-500/10', label: 'Repost' },
  { key: 'likes', icon: 'i-lucide-heart', hover: 'hover:text-rose-500 hover:bg-rose-500/10', label: 'Like' }
] as const
</script>

<template>
  <article class="flex gap-3 px-4 py-3.5 border-b border-default hover:bg-elevated/30 transition-colors cursor-pointer">
    <ReefAvatar :name="person.name" :size="42" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5 text-sm min-w-0">
        <ReefName :person="person" />
        <span class="text-dimmed shrink-0">· {{ post.when }}</span>
      </div>
      <p v-if="post.forkOf" class="text-xs text-muted mt-0.5 flex items-center gap-1"><UIcon name="i-lucide-git-fork" class="size-3.5" />Forked {{ post.forkOf }}</p>
      <p class="text-[15px] text-default leading-relaxed mt-1 whitespace-pre-wrap">{{ post.text }}</p>
      <p v-if="post.question" class="mt-2 inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1" :class="post.question.solved ? 'bg-success/10 text-success' : 'bg-elevated text-muted'">
        <UIcon :name="post.question.solved ? 'i-lucide-circle-check' : 'i-lucide-circle-help'" class="size-3.5" />
        {{ post.question.solved ? 'Answered' : 'Open question' }} · {{ post.question.answers }} {{ post.question.answers === 1 ? 'answer' : 'answers' }}
      </p>
      <div v-if="embedded" class="mt-3"><ProjectEmbed :project="embedded" /></div>
      <div class="flex items-center justify-between max-w-md mt-2 -ml-2 text-muted">
        <button v-for="a in ACTIONS" :key="a.key" type="button" class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors active:scale-95" :class="a.hover" :aria-label="`${a.label}, ${post[a.key]}`">
          <UIcon :name="a.icon" class="size-4" />{{ fmt(post[a.key]) }}
        </button>
        <button type="button" class="inline-flex items-center rounded-full px-2 py-1 transition-colors hover:text-sky-500 hover:bg-sky-500/10 active:scale-95" aria-label="Share"><UIcon name="i-lucide-share" class="size-4" /></button>
      </div>
    </div>
  </article>
</template>
