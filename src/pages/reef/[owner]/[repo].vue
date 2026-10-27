<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useClipboard } from '@vueuse/core'
import { ReefApiError, projectUrl, useReef } from '../../../composables/useReef'
import { useReefMe } from '../../../composables/useReefMe'
import { useReefUi } from '../../../composables/useReefUi'
import { KINDS, NEED_ICONS } from '../../../utils/reefKinds'
import { fmt, monthYear, shortAgo } from '../../../utils/reefTime'
import type { PostView, ProjectCard, ProjectDetail } from '../../../types/reef'
import ReefShell from '../../../components/reef/ReefShell.vue'
import ReefAvatar from '../../../components/reef/ReefAvatar.vue'
import ReefName from '../../../components/reef/ReefName.vue'
import ReefFindings from '../../../components/reef/ReefFindings.vue'
import ReefSkeleton from '../../../components/reef/ReefSkeleton.vue'
import ReefState from '../../../components/reef/ReefState.vue'
import SafeMarkdown from '../../../components/reef/SafeMarkdown.vue'
import InstallDialog from '../../../components/reef/InstallDialog.vue'
import ForkDialog from '../../../components/reef/ForkDialog.vue'
import ReportDialog from '../../../components/reef/ReportDialog.vue'
import ModalConfirm from '../../../components/ModalConfirm.vue'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const router = useRouter()
const api = useReef()
const toast = useToast()
const overlay = useOverlay()
const { copy } = useClipboard()
const { requireProfile } = useReefMe()
const { openPublish, openAsk } = useReefUi()

const owner = computed(() => String(route.params.owner).toLowerCase())
const repo = computed(() => String(route.params.repo).toLowerCase())
const id = computed(() => `${owner.value}/${repo.value}`)

const p = ref<ProjectDetail | null>(null)
const status = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const failure = ref('')
useHead({ title: computed(() => (p.value ? `${p.value.owner}/${p.value.name} · The Reef` : 'Project · The Reef')) })

const tab = ref<'Overview' | 'Versions' | 'Forks' | 'Questions' | 'Needs'>('Overview')
const forks = ref<ProjectCard[] | null>(null)
const questions = ref<PostView[] | null>(null)
const tabLoading = ref(false)
const tabError = ref('')

const installing = ref(false)
const forking = ref(false)
const reporting = ref(false)

async function load() {
  status.value = 'loading'
  p.value = null
  forks.value = questions.value = null
  tab.value = 'Overview'
  try {
    p.value = await api.project(owner.value, repo.value)
    status.value = 'ready'
  } catch (err: any) {
    if (err instanceof ReefApiError && err.notFound) status.value = 'missing'
    else { status.value = 'error'; failure.value = err?.message || 'Could not load this project.' }
  }
}
watch(id, load, { immediate: true })

async function loadTab() {
  tabError.value = ''
  try {
    if (tab.value === 'Forks' && !forks.value) { tabLoading.value = true; forks.value = (await api.forks(owner.value, repo.value)).items }
    else if (tab.value === 'Questions' && !questions.value) { tabLoading.value = true; questions.value = (await api.projectQuestions(owner.value, repo.value)).items }
  } catch (err: any) {
    tabError.value = err?.message || 'Could not load this tab.'
  } finally {
    tabLoading.value = false
  }
}
watch(tab, loadTab)

const tabs = computed(() => p.value ? [
  { name: 'Overview', icon: 'i-lucide-book-open' },
  { name: 'Versions', icon: 'i-lucide-tag', count: p.value.versions.length },
  { name: 'Forks', icon: 'i-lucide-git-fork', count: p.value.forks },
  { name: 'Questions', icon: 'i-lucide-circle-help' },
  { name: 'Needs', icon: 'i-lucide-shield-check' }
] as const : [])

const starBusy = ref(false)
async function toggleStar() {
  const cur = p.value
  if (!cur || starBusy.value) return
  if (!requireProfile(toggleStar)) return
  starBusy.value = true
  const was = cur.starred
  p.value = { ...cur, starred: !was, stars: cur.stars + (was ? -1 : 1) }
  try {
    const out = was ? await api.unstar(cur.owner, cur.name) : await api.star(cur.owner, cur.name)
    p.value = { ...p.value!, starred: out.starred, stars: out.stars }
  } catch (err: any) {
    p.value = cur
    toast.add({ title: 'Could not do that', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    starBusy.value = false
  }
}

const add = () => { if (requireProfile(() => { installing.value = true })) installing.value = true }
const fork = () => { if (requireProfile(() => { forking.value = true })) forking.value = true }
const report = () => { if (requireProfile(() => { reporting.value = true })) reporting.value = true }
const askId = () => `${owner.value}__${repo.value}`
const ask = () => { if (requireProfile(() => openAsk(askId()))) openAsk(askId()) }
const newVersion = () => { if (p.value) openPublish(null, p.value.name) }

async function share() {
  if (!p.value) return
  await copy(projectUrl(p.value.owner, p.value.name))
  toast.add({ title: 'Link copied', icon: 'i-lucide-link', color: 'neutral' })
}

const removeModal = overlay.create(ModalConfirm)
async function remove() {
  const cur = p.value
  if (!cur) return
  const ok = await removeModal.open({ title: 'Remove this project?', description: 'It disappears from The Reef, with its versions and stars. Copies people already added to their OpenLobs stay with them. Forks keep their own copy. This cannot be undone.', confirmLabel: 'Remove' }).result
  if (!ok) return
  try {
    await api.removeProject(cur.owner, cur.name)
    toast.add({ title: 'Removed', icon: 'i-lucide-trash-2', color: 'neutral' })
    await router.replace('/reef/projects')
  } catch (err: any) {
    toast.add({ title: 'Could not remove it', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const menu = computed(() => p.value ? [[
  { label: 'Copy link', icon: 'i-lucide-link', onSelect: share },
  ...(p.value.isOwner
    ? [{ label: 'Publish a new version', icon: 'i-lucide-upload', onSelect: newVersion }, { label: 'Remove project', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }]
    : [{ label: 'Report', icon: 'i-lucide-flag', onSelect: report }])
]] : [])

const DOTS: Record<string, string> = { Instructions: 'bg-sky-500', Settings: 'bg-emerald-500', README: 'bg-violet-500' }
const lastChange = computed(() => p.value?.versions[0])
const fileNote = (name: string) => ({ 'instructions.md': 'What the agent is told', 'agent.json': 'Name, tools and limits', skills: 'Skills it uses', 'README.md': 'About this project' } as Record<string, string>)[name] ?? ''
</script>

<template>
  <ReefShell wide title="" back>
    <ReefSkeleton v-if="status === 'loading'" :rows="3" />
    <ReefState v-else-if="status === 'missing'" icon="i-lucide-waves" title="Nothing here" text="This project does not exist, or it was removed.">
      <UButton label="Browse projects" to="/reef/projects" color="neutral" />
    </ReefState>
    <ReefState v-else-if="status === 'error'" tone="error" icon="i-lucide-cloud-off" title="Could not load this project" :text="failure"><UButton label="Try again" color="neutral" variant="outline" @click="load" /></ReefState>

    <template v-else-if="p">
      <div class="px-4 sm:px-6 pt-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
          <div class="flex items-center gap-2 min-w-0 text-xl">
            <UIcon :name="KINDS[p.kind].icon" class="size-6 shrink-0" :class="KINDS[p.kind].text" />
            <RouterLink :to="`/reef/u/${p.owner}`" class="text-primary hover:underline truncate">{{ p.owner }}</RouterLink>
            <span class="text-muted">/</span>
            <h1 class="font-semibold text-highlighted truncate">{{ p.name }}</h1>
            <UBadge label="Public" color="neutral" variant="outline" size="sm" class="ml-1 shrink-0" />
            <UBadge :label="KINDS[p.kind].label" color="neutral" variant="subtle" size="sm" class="shrink-0" />
          </div>
          <div class="ml-auto flex items-center gap-2">
            <UButton v-if="p.licence.id !== 'all-rights-reserved'" :label="`Fork ${fmt(p.forks)}`" icon="i-lucide-git-fork" color="neutral" variant="outline" size="sm" @click="fork" />
            <UButton :label="`${p.starred ? 'Starred' : 'Star'} ${fmt(p.stars)}`" icon="i-lucide-star" :class="p.starred ? 'text-amber-500' : ''" color="neutral" variant="outline" size="sm" :aria-pressed="p.starred" @click="toggleStar" />
            <UButton label="Add to OpenLobs" icon="i-lucide-plus" color="primary" size="sm" @click="add" />
            <UDropdownMenu :items="menu" :content="{ align: 'end' }"><UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="More" /></UDropdownMenu>
          </div>
        </div>
        <p v-if="p.forkedFrom" class="text-xs text-muted mt-1">forked from <RouterLink :to="`/reef/${p.forkedFrom.owner}/${p.forkedFrom.name}`" class="hover:underline text-primary">{{ p.forkedFrom.owner }}/{{ p.forkedFrom.name }}</RouterLink> at version {{ p.forkedFrom.version }}</p>
        <UAlert v-if="p.isOwner && p.safety === 'review'" class="mt-3" color="warning" variant="subtle" icon="i-lucide-shield-alert" title="This is only shown to you until it is checked" description="The automatic check found something worth a second look. See the Needs tab." />
      </div>

      <nav class="flex gap-1 px-2 sm:px-4 mt-4 border-b border-default overflow-x-auto" role="tablist" aria-label="Project">
        <button v-for="t in tabs" :key="t.name" type="button" role="tab" :aria-selected="tab === t.name" class="relative shrink-0 inline-flex items-center gap-2 px-3 py-3 text-sm transition-colors hover:bg-elevated/60 rounded-t-lg" :class="tab === t.name ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t.name">
          <UIcon :name="t.icon" class="size-4" />{{ t.name }}
          <span v-if="'count' in t" class="rounded-full bg-elevated px-1.5 text-xs text-muted">{{ t.count }}</span>
          <span v-if="tab === t.name" class="absolute -bottom-px inset-x-2 h-0.5 rounded-full bg-primary" />
        </button>
      </nav>

      <div class="grid lg:grid-cols-[1fr_280px] gap-6 p-4 sm:p-6">
        <div class="min-w-0">
          <template v-if="tab === 'Overview'">
            <div class="rounded-xl border border-default overflow-hidden">
              <div class="flex items-center gap-3 px-4 py-2.5 bg-elevated/50 border-b border-default text-sm">
                <ReefAvatar :name="p.author.name" :size="22" />
                <span class="font-semibold text-highlighted shrink-0">{{ p.owner }}</span>
                <span class="text-muted truncate">{{ lastChange?.note || `Version ${p.version}` }}</span>
                <span class="ml-auto shrink-0 flex items-center gap-3 text-xs text-muted">
                  <span class="hidden sm:inline">v{{ p.version }} · {{ shortAgo(p.updatedAt) }}</span>
                  <button type="button" class="inline-flex items-center gap-1 hover:text-highlighted" @click="tab = 'Versions'"><UIcon name="i-lucide-history" class="size-3.5" />{{ p.versions.length }} {{ p.versions.length === 1 ? 'version' : 'versions' }}</button>
                </span>
              </div>
              <ul class="divide-y divide-default">
                <li v-for="f in p.files" :key="f.name" class="flex items-center gap-3 px-4 py-2 text-sm">
                  <UIcon :name="f.kind === 'dir' ? 'i-lucide-folder' : 'i-lucide-file-text'" class="size-4 shrink-0" :class="f.kind === 'dir' ? 'text-sky-500' : 'text-muted'" />
                  <span class="w-36 sm:w-44 shrink-0 truncate text-highlighted">{{ f.name }}</span>
                  <span class="min-w-0 flex-1 truncate text-muted hidden sm:block">{{ f.note || fileNote(f.name) }}</span>
                  <span class="text-xs text-dimmed shrink-0 ml-auto">{{ shortAgo(f.at) }}</span>
                </li>
              </ul>
            </div>

            <section v-if="p.readme" class="mt-6 rounded-xl border border-default overflow-hidden" aria-label="README">
              <div class="flex items-center gap-2 px-4 py-2.5 border-b border-default bg-elevated/50 text-sm font-medium text-highlighted"><UIcon name="i-lucide-book-open" class="size-4 text-muted" />README.md</div>
              <div class="px-5 sm:px-8 py-6 max-w-2xl"><SafeMarkdown :value="p.readme" /></div>
            </section>
            <p v-else class="mt-6 text-sm text-muted">The maker did not write a README.</p>
          </template>

          <template v-else>
            <ReefSkeleton v-if="tabLoading" :rows="2" />
            <ReefState v-else-if="tabError" tone="error" icon="i-lucide-cloud-off" title="Could not load this tab" :text="tabError"><UButton label="Try again" color="neutral" variant="outline" @click="loadTab" /></ReefState>

            <ul v-else-if="tab === 'Versions'" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
              <li v-for="(v, i) in p.versions" :key="v.version" class="flex items-center gap-3 px-4 py-3.5">
                <UIcon name="i-lucide-tag" class="size-4 text-muted shrink-0" />
                <div class="min-w-0 flex-1"><p class="text-sm font-semibold text-highlighted">v{{ v.version }} <UBadge v-if="i === 0" label="Latest" color="success" variant="subtle" size="sm" class="ml-1" /></p><p class="text-sm text-muted truncate">{{ v.note || 'No note' }}</p></div>
                <span class="text-xs text-dimmed shrink-0">{{ shortAgo(v.createdAt) }}</span>
              </li>
            </ul>

            <template v-else-if="tab === 'Forks'">
              <ul v-if="forks?.length" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
                <li v-for="f in forks" :key="`${f.owner}/${f.name}`"><RouterLink :to="`/reef/${f.owner}/${f.name}`" class="flex items-center gap-3 px-4 py-3.5 hover:bg-elevated/40 transition-colors"><ReefAvatar :name="f.owner" :size="32" /><div class="min-w-0 flex-1 text-sm"><p class="font-semibold text-highlighted truncate">{{ f.owner }} / {{ f.name }}</p><p class="text-muted">Forked from version {{ f.forkedFrom?.version ?? '?' }}</p></div><UIcon name="i-lucide-git-fork" class="size-4 text-muted" /></RouterLink></li>
              </ul>
              <ReefState v-else-if="forks" icon="i-lucide-git-fork" title="No forks yet" :text="p.licence.id === 'all-rights-reserved' ? 'The maker keeps all rights, so this one cannot be forked.' : 'Fork it to make your own version.'" />
            </template>

            <template v-else-if="tab === 'Questions'">
              <ul v-if="questions?.length" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
                <li v-for="q in questions" :key="q.id"><RouterLink :to="`/reef/post/${q.id}`" class="flex items-start gap-3 px-4 py-3.5 hover:bg-elevated/40 transition-colors"><UIcon :name="q.accepted ? 'i-lucide-circle-check' : 'i-lucide-circle-help'" class="size-4 mt-0.5 shrink-0" :class="q.accepted ? 'text-success' : 'text-muted'" /><div class="min-w-0"><p class="text-sm font-semibold text-highlighted">{{ q.title }}</p><p class="text-xs text-muted mt-0.5">{{ q.replies }} {{ q.replies === 1 ? 'answer' : 'answers' }} · {{ shortAgo(q.createdAt) }}</p></div></RouterLink></li>
              </ul>
              <ReefState v-else-if="questions" icon="i-lucide-circle-help" title="No questions about this yet" text="Stuck on something? Ask, and the maker or someone who used it can answer."><UButton label="Ask a question" color="neutral" @click="ask" /></ReefState>
            </template>

            <div v-else class="space-y-4">
              <div class="rounded-xl border border-default p-4 flex items-start gap-3">
                <UIcon :name="p.safety === 'passed' ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'" class="size-5 mt-0.5 shrink-0" :class="p.safety === 'passed' ? 'text-success' : 'text-warning'" />
                <div><p class="text-sm font-semibold text-highlighted">{{ p.safety === 'passed' ? 'Passed the automatic check' : 'Read this one carefully' }}</p><p class="text-sm text-muted mt-0.5">{{ p.safety === 'passed' ? 'No keys, hidden text or look-alike links were found in the text. The check is not a guarantee, so read the instructions below before you add it.' : 'The automatic check found something worth a second look.' }}</p></div>
              </div>
              <ReefFindings v-if="p.scan.findings.length" :scan="p.scan" mode="review" />
              <div v-if="p.needs.length">
                <h2 class="text-sm font-semibold text-highlighted mb-2">What it can use</h2>
                <ul class="rounded-xl border border-default divide-y divide-default overflow-hidden">
                  <li v-for="n in p.needs" :key="n.id" class="flex items-center gap-3 px-4 py-3"><UIcon :name="NEED_ICONS[n.id] ?? 'i-lucide-puzzle'" class="size-5 shrink-0" /><div class="min-w-0"><p class="text-sm text-highlighted">{{ n.label }}</p><p class="text-xs text-muted">{{ n.detail }}</p></div><UBadge v-if="n.sensitive" label="Switched off until you allow it" color="warning" variant="subtle" size="sm" class="ml-auto shrink-0 hidden sm:inline-flex" /></li>
                </ul>
              </div>
              <p v-else class="text-sm text-muted">It only talks. It uses no tools.</p>
              <div v-if="p.skills.length"><h2 class="text-sm font-semibold text-highlighted mb-2">Skills</h2><div class="flex flex-wrap gap-1.5"><UBadge v-for="s in p.skills" :key="s" :label="s" color="neutral" variant="subtle" size="sm" /></div></div>
              <div>
                <h2 class="text-sm font-semibold text-highlighted mb-2">The instructions, in full</h2>
                <pre class="rounded-xl border border-default bg-elevated/40 p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words max-h-96 overflow-auto">{{ p.instructions }}</pre>
              </div>
            </div>
          </template>
        </div>

        <aside class="space-y-6 text-sm">
          <section>
            <h2 class="font-semibold text-highlighted mb-2">About</h2>
            <p v-if="p.description" class="text-default">{{ p.description }}</p>
            <div v-if="p.tags.length" class="flex flex-wrap gap-1.5 mt-3"><RouterLink v-for="t in p.tags" :key="t" :to="`/reef/projects?tag=${t}`"><UBadge :label="t" color="primary" variant="subtle" size="sm" /></RouterLink></div>
            <ul class="mt-4 space-y-2 text-muted">
              <li class="flex items-center gap-2"><UIcon name="i-lucide-star" class="size-4" /><b class="text-highlighted">{{ fmt(p.stars) }}</b> {{ p.stars === 1 ? 'star' : 'stars' }}</li>
              <li class="flex items-center gap-2"><UIcon name="i-lucide-git-fork" class="size-4" /><b class="text-highlighted">{{ fmt(p.forks) }}</b> {{ p.forks === 1 ? 'fork' : 'forks' }}</li>
              <li class="flex items-center gap-2"><UIcon name="i-lucide-download" class="size-4" /><b class="text-highlighted">{{ fmt(p.installs) }}</b> added</li>
              <li class="flex items-center gap-2"><UIcon name="i-lucide-scale" class="size-4" />{{ p.licence.short }}</li>
              <li class="flex items-center gap-2" :class="p.safety === 'passed' ? 'text-success' : 'text-warning'"><UIcon :name="p.safety === 'passed' ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'" class="size-4" />{{ p.safety === 'passed' ? 'Passed the check' : 'Needs a careful read' }}</li>
            </ul>
          </section>

          <section v-if="p.works.length">
            <h2 class="font-semibold text-highlighted mb-2">Works with</h2>
            <ul class="space-y-2"><li v-for="w in p.works" :key="w.id" class="flex items-center gap-2 text-default"><UIcon :name="NEED_ICONS[w.id] ?? 'i-lucide-puzzle'" class="size-4" />{{ w.label }}</li></ul>
          </section>

          <section>
            <h2 class="font-semibold text-highlighted mb-2">Versions <span class="text-muted font-normal">{{ p.versions.length }}</span></h2>
            <ul class="space-y-2.5">
              <li v-for="(v, i) in p.versions.slice(0, 2)" :key="v.version" class="flex items-start gap-2"><UIcon name="i-lucide-tag" class="size-4 mt-0.5" :class="i === 0 ? 'text-success' : 'text-muted'" /><div class="min-w-0"><p class="font-medium text-highlighted">v{{ v.version }} <UBadge v-if="i === 0" label="Latest" color="success" variant="subtle" size="sm" /></p><p class="text-xs text-muted">{{ shortAgo(v.createdAt) }}</p></div></li>
            </ul>
          </section>

          <section v-if="p.made.length">
            <h2 class="font-semibold text-highlighted mb-2">Made of</h2>
            <div class="flex h-2 overflow-hidden rounded-full"><span v-for="m in p.made" :key="m.label" :class="DOTS[m.label] ?? 'bg-muted'" :style="{ width: `${m.pct}%` }" /></div>
            <ul class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs"><li v-for="m in p.made" :key="m.label" class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" :class="DOTS[m.label] ?? 'bg-muted'" /><b class="text-highlighted">{{ m.label }}</b><span class="text-muted">{{ m.pct }}%</span></li></ul>
          </section>

          <section>
            <h2 class="font-semibold text-highlighted mb-2">Maker</h2>
            <div class="flex items-center gap-2.5"><ReefAvatar :name="p.author.name" :size="32" /><div class="leading-tight min-w-0"><ReefName :person="p.author" :handle="false" /><p class="text-xs text-muted">@{{ p.author.handle }} · since {{ monthYear(p.createdAt) }}</p></div></div>
          </section>
        </aside>
      </div>

      <InstallDialog v-model:open="installing" :project="p" />
      <ForkDialog v-model:open="forking" :project="p" />
      <ReportDialog v-model:open="reporting" title="Report this project" :send="(reason: string, note: string) => api.reportProject(p!.owner, p!.name, reason, note)" />
    </template>
  </ReefShell>
</template>
