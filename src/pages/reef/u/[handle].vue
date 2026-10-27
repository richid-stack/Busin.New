<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ReefApiError, useReef } from '../../../composables/useReef'
import { useReefMe } from '../../../composables/useReefMe'
import { fmt, monthYear } from '../../../utils/reefTime'
import { accentGradient } from '../../../utils/accentGradient'
import type { PersonPage, PostView, ProjectCard, ReefProfile } from '../../../types/reef'
import ReefShell from '../../../components/reef/ReefShell.vue'
import ReefAvatar from '../../../components/reef/ReefAvatar.vue'
import PostItem from '../../../components/reef/PostItem.vue'
import ProjectEmbed from '../../../components/reef/ProjectEmbed.vue'
import ProfileEditDialog from '../../../components/reef/ProfileEditDialog.vue'
import ReefSkeleton from '../../../components/reef/ReefSkeleton.vue'
import ReefState from '../../../components/reef/ReefState.vue'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const api = useReef()
const toast = useToast()
const { requireProfile, admin, setProfile, reload } = useReefMe()

const handle = computed(() => String(route.params.handle).toLowerCase())
const person = ref<PersonPage | null>(null)
const status = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const failure = ref('')
useHead({ title: computed(() => `${person.value?.name ?? 'Profile'} · The Reef`) })

const TABS = ['Projects', 'Posts', 'Questions', 'Stars'] as const
const tab = ref<typeof TABS[number]>('Projects')
const projects = ref<ProjectCard[] | null>(null)
const stars = ref<ProjectCard[] | null>(null)
const posts = ref<PostView[] | null>(null)
const questions = ref<PostView[] | null>(null)
const tabLoading = ref(false)
const tabError = ref('')

async function loadPerson() {
  status.value = 'loading'
  person.value = null
  projects.value = stars.value = posts.value = questions.value = null
  tab.value = 'Projects'
  try {
    person.value = await api.person(handle.value)
    status.value = 'ready'
    void loadTab()
  } catch (err: any) {
    if (err instanceof ReefApiError && err.notFound) status.value = 'missing'
    else { status.value = 'error'; failure.value = err?.message || 'Could not load this person.' }
  }
}

async function loadTab() {
  tabError.value = ''
  const h = handle.value
  try {
    if (tab.value === 'Projects' && !projects.value) { tabLoading.value = true; projects.value = (await api.personProjects(h)).items }
    else if (tab.value === 'Stars' && !stars.value) { tabLoading.value = true; stars.value = (await api.personStars(h)).items }
    else if (tab.value === 'Posts' && !posts.value) { tabLoading.value = true; posts.value = (await api.personPosts(h, { kind: 'posts' })).items }
    else if (tab.value === 'Questions' && !questions.value) { tabLoading.value = true; questions.value = (await api.personPosts(h, { kind: 'questions' })).items }
  } catch (err: any) {
    tabError.value = err?.message || 'Could not load this tab.'
  } finally {
    tabLoading.value = false
  }
}
watch(handle, loadPerson, { immediate: true })
watch(tab, loadTab)

const busy = ref(false)
async function toggleFollow() {
  const p = person.value
  if (!p || busy.value) return
  if (!requireProfile(toggleFollow)) return
  busy.value = true
  try {
    const out = p.viewerFollows ? await api.unfollow(p.handle) : await api.follow(p.handle)
    person.value = { ...p, viewerFollows: out.following, followers: out.followers }
    void reload()
  } catch (err: any) {
    toast.add({ title: 'Could not do that', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    busy.value = false
  }
}

const editing = ref(false)
const saved = (profile: ReefProfile) => { person.value = { ...person.value!, ...profile }; setProfile(profile) }

async function badge(kind: 'verified' | 'official') {
  const p = person.value
  if (!p) return
  try {
    const out = await api.badge({ handle: p.handle, [kind]: !p[kind] })
    person.value = { ...p, ...out }
  } catch (err: any) {
    toast.add({ title: 'Could not change the badge', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
const adminMenu = computed(() => person.value ? [[
  { label: person.value.verified ? 'Remove verified' : 'Make verified', icon: 'i-lucide-badge-check', onSelect: () => badge('verified') },
  { label: person.value.official ? 'Remove official' : 'Make official', icon: 'i-lucide-shield-check', onSelect: () => badge('official') }
]] : [])

const gone = (list: 'posts' | 'questions') => (id: string) => { const cur = list === 'posts' ? posts : questions; cur.value = (cur.value ?? []).filter(p => p.id !== id) }
</script>

<template>
  <ReefShell :title="person?.name ?? 'Profile'" back>
    <ReefSkeleton v-if="status === 'loading'" :rows="3" />
    <ReefState v-else-if="status === 'missing'" icon="i-lucide-user-round-x" title="This account does not exist" text="Check the handle, or search for someone else." />
    <ReefState v-else-if="status === 'error'" tone="error" icon="i-lucide-cloud-off" title="Could not load this person" :text="failure"><UButton label="Try again" color="neutral" variant="outline" @click="loadPerson" /></ReefState>

    <template v-else-if="person">
      <div class="h-36 sm:h-48" :class="accentGradient(person.name)" />
      <div class="px-4">
        <div class="flex items-start justify-between -mt-12 sm:-mt-16">
          <span class="rounded-full border-4 border-default bg-default"><ReefAvatar :name="person.name" :size="96" /></span>
          <div class="mt-14 sm:mt-[4.5rem] flex items-center gap-2">
            <UDropdownMenu v-if="admin && !person.isMe" :items="adminMenu" :content="{ align: 'end' }"><UButton icon="i-lucide-shield" color="neutral" variant="outline" class="rounded-full" aria-label="Badges" /></UDropdownMenu>
            <UButton v-if="person.isMe" label="Edit profile" color="neutral" variant="outline" class="rounded-full px-5" @click="editing = true" />
            <UButton v-else :label="person.viewerFollows ? 'Following' : 'Follow'" color="neutral" :variant="person.viewerFollows ? 'outline' : 'solid'" class="rounded-full px-5" :loading="busy" @click="toggleFollow" />
          </div>
        </div>
        <h2 class="mt-3 flex items-center gap-1.5 text-xl font-bold text-highlighted">{{ person.name }}
          <UIcon v-if="person.verified || person.official" name="i-lucide-badge-check" class="size-5" :class="person.official ? 'text-primary' : 'text-sky-500'" :title="person.official ? 'Made by OpenLobs' : 'Verified maker'" />
        </h2>
        <p class="text-muted text-sm">@{{ person.handle }}<span v-if="person.official"> · Official</span></p>
        <p v-if="person.bio" class="mt-3 text-[15px] text-default whitespace-pre-wrap break-words">{{ person.bio }}</p>
        <p class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-muted">
          <span v-if="person.place" class="inline-flex items-center gap-1"><UIcon name="i-lucide-map-pin" class="size-4" />{{ person.place }}</span>
          <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-calendar" class="size-4" />Joined {{ monthYear(person.createdAt) }}</span>
        </p>
        <p class="flex gap-5 mt-3 text-sm text-muted">
          <span><b class="text-highlighted">{{ fmt(person.following) }}</b> Following</span>
          <span><b class="text-highlighted">{{ fmt(person.followers) }}</b> {{ person.followers === 1 ? 'Follower' : 'Followers' }}</span>
          <span><b class="text-highlighted">{{ fmt(person.starsEarned) }}</b> Stars earned</span>
        </p>
      </div>

      <div class="flex mt-4 border-b border-default" role="tablist">
        <button v-for="t in TABS" :key="t" type="button" role="tab" :aria-selected="tab === t" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t">
          {{ t }}<span v-if="tab === t" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-primary" />
        </button>
      </div>

      <ReefSkeleton v-if="tabLoading" :rows="2" />
      <ReefState v-else-if="tabError" tone="error" icon="i-lucide-cloud-off" title="Could not load this tab" :text="tabError"><UButton label="Try again" color="neutral" variant="outline" @click="loadTab" /></ReefState>
      <template v-else>
        <div v-if="tab === 'Projects'" class="p-4">
          <div v-if="projects?.length" class="grid sm:grid-cols-2 gap-3"><ProjectEmbed v-for="p in projects" :key="p.name" :project="p" /></div>
          <p v-else class="text-sm text-muted py-10 text-center">{{ person.isMe ? 'You have not shared a project yet.' : 'No projects yet.' }}</p>
        </div>
        <div v-else-if="tab === 'Stars'" class="p-4">
          <div v-if="stars?.length" class="grid sm:grid-cols-2 gap-3"><ProjectEmbed v-for="p in stars" :key="`${p.owner}/${p.name}`" :project="p" /></div>
          <p v-else class="text-sm text-muted py-10 text-center">Nothing starred yet.</p>
        </div>
        <div v-else-if="tab === 'Posts'">
          <PostItem v-for="p in posts ?? []" :key="p.id" :post="p" @deleted="gone('posts')" />
          <p v-if="posts && !posts.length" class="text-sm text-muted py-10 text-center">No posts yet.</p>
        </div>
        <div v-else>
          <PostItem v-for="p in questions ?? []" :key="p.id" :post="p" @deleted="gone('questions')" />
          <p v-if="questions && !questions.length" class="text-sm text-muted py-10 text-center">No questions yet.</p>
        </div>
      </template>

      <ProfileEditDialog v-if="person.isMe" v-model:open="editing" :profile="person" @saved="saved" />
    </template>
  </ReefShell>
</template>
