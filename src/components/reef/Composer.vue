<script setup lang="ts">
import { computed, ref } from 'vue'
import { ReefApiError, useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { useReefUi } from '../../composables/useReefUi'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import type { PostView, ProjectCard } from '../../types/reef'
import ReefAvatar from './ReefAvatar.vue'

const emit = defineEmits<{ posted: [post: PostView] }>()
const props = withDefaults(defineProps<{ placeholder?: string, reply?: boolean, send?: (text: string, projectId: string | null) => Promise<PostView>, max?: number }>(), { placeholder: 'What did you build, or what are you stuck on?', reply: false, max: 500 })

const toast = useToast()
const api = useReef()
const { profile, signedIn, requireProfile } = useReefMe()
const { openAsk } = useReefUi()
const { openAuthModal } = useFirebaseAuth()

const text = ref('')
const busy = ref(false)
const attached = ref<ProjectCard | null>(null)
const mine = ref<ProjectCard[] | null>(null)
const left = computed(() => props.max - text.value.length)

async function loadMine() {
  if (mine.value || !profile.value) return
  try { mine.value = (await api.personProjects(profile.value.handle)).items } catch { mine.value = [] }
}

const attachMenu = computed(() => [mine.value === null
  ? [{ label: 'Loading…', disabled: true }]
  : mine.value.length
    ? mine.value.map(p => ({ label: `${p.owner}/${p.name}`, icon: 'i-lucide-bot', onSelect: () => { attached.value = p } }))
    : [{ label: 'You have no projects yet', disabled: true }]])

async function submit() {
  const body = text.value.trim()
  if (!body || busy.value || left.value < 0) return
  if (!requireProfile(submit)) return
  busy.value = true
  try {
    const post = props.send ? await props.send(body, attached.value ? `${attached.value.owner}__${attached.value.name}` : null) : await api.post({ text: body, projectId: attached.value ? `${attached.value.owner}__${attached.value.name}` : null })
    text.value = ''
    attached.value = null
    emit('posted', post)
  } catch (err: any) {
    const scan = err instanceof ReefApiError ? err.scan : undefined
    toast.add({ title: scan ? 'This cannot be posted' : 'Could not post', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="!signedIn" class="flex items-center gap-3 px-4 py-4 border-b border-default">
    <span class="size-[42px] shrink-0 rounded-full bg-elevated flex items-center justify-center text-muted"><UIcon name="i-lucide-user-round" class="size-5" /></span>
    <p class="flex-1 text-sm text-muted">{{ reply ? 'Sign in to reply.' : 'Anyone can read. Sign in to post, ask and share.' }}</p>
    <UButton label="Sign in" color="neutral" size="sm" class="rounded-full" @click="openAuthModal()" />
  </div>
  <div v-else class="flex gap-3 px-4 py-4 border-b border-default">
    <ReefAvatar :name="profile?.name || '?'" :size="42" />
    <div class="min-w-0 flex-1">
      <UTextarea v-model="text" :placeholder="placeholder" autoresize :rows="reply ? 2 : 2" :maxrows="8" variant="none" class="w-full -mx-2" :ui="{ base: 'text-lg placeholder:text-dimmed resize-none px-2' }" aria-label="Write something" @focus="requireProfile()" @keydown.meta.enter="submit" @keydown.ctrl.enter="submit" />
      <div v-if="attached" class="mb-3 flex items-center gap-2 rounded-xl border border-default px-3 py-2 text-sm">
        <UIcon name="i-lucide-bot" class="size-4 text-sky-500" /><span class="truncate"><span class="text-muted">{{ attached.owner }} /</span> <b class="text-highlighted">{{ attached.name }}</b></span>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" class="ml-auto" aria-label="Remove" @click="attached = null" />
      </div>
      <div class="flex items-center gap-1 border-t border-default pt-3">
        <UDropdownMenu v-if="!reply" :items="attachMenu" :content="{ align: 'start' }" @update:open="(o: boolean) => o && loadMine()">
          <UButton icon="i-lucide-boxes" color="primary" variant="ghost" size="sm" square aria-label="Attach one of your projects" />
        </UDropdownMenu>
        <UButton v-if="!reply" icon="i-lucide-circle-help" color="primary" variant="ghost" size="sm" square aria-label="Ask a question" @click="requireProfile(() => openAsk()) && openAsk()" />
        <span class="ml-auto text-xs mr-3" :class="left < 0 ? 'text-error' : left < 40 ? 'text-warning' : 'text-dimmed'">{{ text ? left : '' }}</span>
        <UButton :label="reply ? 'Reply' : 'Post'" color="neutral" class="rounded-full px-5" :loading="busy" :disabled="!text.trim() || left < 0" @click="submit" />
      </div>
    </div>
  </div>
</template>
