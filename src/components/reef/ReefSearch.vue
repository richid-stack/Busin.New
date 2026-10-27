<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn, onClickOutside } from '@vueuse/core'
import { useReef } from '../../composables/useReef'
import type { ProjectCard } from '../../types/reef'
import ReefAvatar from './ReefAvatar.vue'

const router = useRouter()
const api = useReef()
const q = ref('')
const open = ref(false)
const busy = ref(false)
const projects = ref<ProjectCard[]>([])
const people = ref<Array<{ handle: string, name: string }>>([])
const failed = ref(false)
const root = ref<HTMLElement | null>(null)
onClickOutside(root, () => { open.value = false })

let seq = 0
const run = useDebounceFn(async () => {
  const mine = ++seq
  const text = q.value.trim()
  if (!text) { projects.value = []; people.value = []; busy.value = false; return }
  busy.value = true
  failed.value = false
  try {
    const out = await api.search(text)
    if (mine !== seq) return
    projects.value = out.projects
    people.value = out.people
  } catch {
    if (mine === seq) failed.value = true
  } finally {
    if (mine === seq) busy.value = false
  }
}, 250)
watch(q, () => { open.value = true; busy.value = Boolean(q.value.trim()); void run() })

const go = (to: string) => { open.value = false; q.value = ''; void router.push(to) }
const submit = () => { const text = q.value.trim(); if (text) go(`/reef/projects?q=${encodeURIComponent(text)}`) }
</script>

<template>
  <div ref="root" class="relative">
    <form class="flex items-center gap-2 rounded-full bg-elevated px-4 py-2.5 text-muted focus-within:ring-2 focus-within:ring-primary" role="search" @submit.prevent="submit">
      <UIcon name="i-lucide-search" class="size-4 shrink-0" />
      <input v-model="q" class="bg-transparent outline-none text-sm w-full placeholder:text-dimmed text-default" placeholder="Search The Reef" aria-label="Search The Reef" autocomplete="off" @focus="open = true">
    </form>
    <div v-if="open && q.trim()" class="absolute z-30 mt-2 w-full rounded-2xl border border-default bg-default shadow-lg overflow-hidden">
      <p v-if="busy && !projects.length && !people.length" class="px-4 py-3 text-sm text-muted">Searching…</p>
      <p v-else-if="failed" class="px-4 py-3 text-sm text-muted">Search is not working right now. Try again.</p>
      <template v-else>
        <button v-for="p in projects" :key="`${p.owner}/${p.name}`" type="button" class="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-elevated transition-colors" @click="go(`/reef/${p.owner}/${p.name}`)">
          <UIcon name="i-lucide-bot" class="size-4 text-sky-500 shrink-0" />
          <span class="min-w-0 text-sm"><span class="text-muted">{{ p.owner }} /</span> <span class="font-medium text-highlighted">{{ p.name }}</span></span>
        </button>
        <button v-for="p in people" :key="p.handle" type="button" class="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-elevated transition-colors" @click="go(`/reef/u/${p.handle}`)">
          <ReefAvatar :name="p.name" :size="22" />
          <span class="min-w-0 text-sm truncate"><span class="font-medium text-highlighted">{{ p.name }}</span> <span class="text-muted">@{{ p.handle }}</span></span>
        </button>
        <p v-if="!projects.length && !people.length && !busy" class="px-4 py-3 text-sm text-muted">Nothing found for “{{ q.trim() }}”.</p>
        <button v-if="projects.length || people.length" type="button" class="flex w-full items-center gap-2 border-t border-default px-4 py-2.5 text-left text-sm text-primary hover:bg-elevated transition-colors" @click="submit"><UIcon name="i-lucide-search" class="size-4" />All results for “{{ q.trim() }}”</button>
      </template>
    </div>
  </div>
</template>
