<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { KINDS, PEOPLE, QUESTIONS, fmt, project as findProject } from '../../../reef/concept'
import ReefShell from '../../../components/reef/ReefShell.vue'
import ReefAvatar from '../../../components/reef/ReefAvatar.vue'
import ReefName from '../../../components/reef/ReefName.vue'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const p = computed(() => findProject(String(route.params.owner), String(route.params.repo)))
const owner = computed(() => (p.value ? PEOPLE[p.value.owner]! : null))
useHead({ title: computed(() => (p.value ? `${p.value.owner}/${p.value.name} · The Reef` : 'Not found · The Reef')) })

const tab = ref('Overview')
const tabs = computed(() => p.value ? [
  { name: 'Overview', icon: 'i-lucide-book-open' },
  { name: 'Versions', icon: 'i-lucide-tag', count: p.value.versions.length },
  { name: 'Forks', icon: 'i-lucide-git-fork', count: p.value.forks },
  { name: 'Questions', icon: 'i-lucide-circle-help', count: p.value.questions },
  { name: 'Needs', icon: 'i-lucide-shield-check' }
] : [])
const questions = computed(() => QUESTIONS.filter(q => q.project === `${p.value?.owner}/${p.value?.name}`).concat(QUESTIONS.slice(0, 2)))
const forkers = ['nanayaa', 'efua', 'yaw'].map(h => PEOPLE[h]!)
const starred = ref(false)
</script>

<template>
  <ReefShell v-if="p && owner" wide title="" back>
    <div class="px-4 sm:px-6 pt-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div class="flex items-center gap-2 min-w-0 text-xl">
          <UIcon :name="KINDS[p.kind].icon" class="size-6 shrink-0" :class="KINDS[p.kind].text" />
          <RouterLink :to="`/reef/u/${owner.handle}`" class="text-primary hover:underline truncate">{{ owner.handle }}</RouterLink>
          <span class="text-muted">/</span>
          <h1 class="font-semibold text-highlighted truncate">{{ p.name }}</h1>
          <UBadge label="Public" color="neutral" variant="outline" size="sm" class="ml-1" />
          <UBadge :label="KINDS[p.kind].label" color="neutral" variant="subtle" size="sm" />
        </div>
        <div class="ml-auto flex items-center gap-2">
          <UButton :label="`Fork ${p.forks}`" icon="i-lucide-git-fork" color="neutral" variant="outline" size="sm" />
          <UButton :label="`${starred ? 'Starred' : 'Star'} ${p.stars + (starred ? 1 : 0)}`" :icon="starred ? 'i-lucide-star' : 'i-lucide-star'" :class="starred ? 'text-amber-500' : ''" color="neutral" variant="outline" size="sm" @click="starred = !starred" />
          <UButton label="Add to OpenLobs" icon="i-lucide-plus" color="primary" size="sm" />
        </div>
      </div>
      <p v-if="p.forkedFrom" class="text-xs text-muted mt-1">forked from {{ p.forkedFrom }}</p>
    </div>

    <nav class="flex gap-1 px-2 sm:px-4 mt-4 border-b border-default overflow-x-auto" role="tablist" aria-label="Project">
      <button v-for="t in tabs" :key="t.name" type="button" role="tab" :aria-selected="tab === t.name" class="relative shrink-0 inline-flex items-center gap-2 px-3 py-3 text-sm transition-colors hover:bg-elevated/60 rounded-t-lg" :class="tab === t.name ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t.name">
        <UIcon :name="t.icon" class="size-4" />{{ t.name }}
        <span v-if="t.count !== undefined" class="rounded-full bg-elevated px-1.5 text-xs text-muted">{{ t.count }}</span>
        <span v-if="tab === t.name" class="absolute -bottom-px inset-x-2 h-0.5 rounded-full bg-primary" />
      </button>
    </nav>

    <div class="grid lg:grid-cols-[1fr_280px] gap-6 p-4 sm:p-6">
      <!-- Main -->
      <div class="min-w-0">
        <template v-if="tab === 'Overview'">
          <div class="rounded-xl border border-default overflow-hidden">
            <div class="flex items-center gap-3 px-4 py-2.5 bg-elevated/50 border-b border-default text-sm">
              <ReefAvatar :name="owner.name" :size="22" />
              <span class="font-semibold text-highlighted shrink-0">{{ owner.handle }}</span>
              <span class="text-muted truncate">{{ p.versions[0]!.title }}</span>
              <span class="ml-auto shrink-0 flex items-center gap-3 text-xs text-muted">
                <span class="hidden sm:inline">{{ p.version }} · {{ p.updated }}</span>
                <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-history" class="size-3.5" />{{ p.versions.length }} versions</span>
              </span>
            </div>
            <ul class="divide-y divide-default">
              <li v-for="f in p.files" :key="f.name" class="flex items-center gap-3 px-4 py-2 text-sm hover:bg-elevated/40 transition-colors cursor-pointer">
                <UIcon :name="f.kind === 'dir' ? 'i-lucide-folder' : 'i-lucide-file-text'" class="size-4 shrink-0" :class="f.kind === 'dir' ? 'text-sky-500' : 'text-muted'" />
                <span class="w-44 shrink-0 truncate text-highlighted hover:underline hover:text-primary">{{ f.name }}</span>
                <span class="min-w-0 flex-1 truncate text-muted hidden sm:block">{{ f.note }}</span>
                <span class="text-xs text-dimmed shrink-0 ml-auto">{{ f.when }}</span>
              </li>
            </ul>
          </div>

          <section class="mt-6 rounded-xl border border-default overflow-hidden" aria-label="README">
            <div class="flex items-center gap-2 px-4 py-2.5 border-b border-default bg-elevated/50 text-sm font-medium text-highlighted"><UIcon name="i-lucide-book-open" class="size-4 text-muted" />README.md</div>
            <div class="px-5 sm:px-8 py-6 space-y-3 max-w-2xl">
              <template v-for="(b, i) in p.readme" :key="i">
                <h2 v-if="b.h" class="text-lg font-semibold text-highlighted pt-2 first:pt-0" :class="i === 0 ? 'text-2xl pb-2 border-b border-default' : ''">{{ b.h }}</h2>
                <p v-if="b.p" class="text-[15px] leading-relaxed text-default">{{ b.p }}</p>
                <ul v-if="b.list" class="list-disc pl-5 space-y-1 text-[15px] text-default"><li v-for="li in b.list" :key="li">{{ li }}</li></ul>
              </template>
            </div>
          </section>
        </template>

        <ul v-else-if="tab === 'Versions'" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
          <li v-for="v in p.versions" :key="v.tag" class="flex items-center gap-3 px-4 py-3.5">
            <UIcon name="i-lucide-tag" class="size-4 text-muted shrink-0" />
            <div class="min-w-0 flex-1"><p class="text-sm font-semibold text-highlighted">{{ v.tag }} <UBadge v-if="v.latest" label="Latest" color="success" variant="subtle" size="sm" class="ml-1" /></p><p class="text-sm text-muted truncate">{{ v.title }}</p></div>
            <span class="text-xs text-dimmed shrink-0">{{ v.when }}</span>
          </li>
        </ul>

        <ul v-else-if="tab === 'Forks'" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
          <li v-for="f in forkers" :key="f.handle" class="flex items-center gap-3 px-4 py-3.5"><ReefAvatar :name="f.name" :size="32" /><div class="min-w-0 flex-1 text-sm"><p class="font-semibold text-highlighted">{{ f.handle }} / {{ p.name }}</p><p class="text-muted">Forked from {{ owner.handle }}/{{ p.name }}</p></div><UIcon name="i-lucide-git-fork" class="size-4 text-muted" /></li>
        </ul>

        <ul v-else-if="tab === 'Questions'" class="rounded-xl border border-default divide-y divide-default overflow-hidden">
          <li v-for="q in questions" :key="q.id" class="flex items-start gap-3 px-4 py-3.5"><UIcon :name="q.solved ? 'i-lucide-circle-check' : 'i-lucide-circle-help'" class="size-4 mt-0.5 shrink-0" :class="q.solved ? 'text-success' : 'text-muted'" /><div class="min-w-0"><p class="text-sm font-semibold text-highlighted">{{ q.title }}</p><p class="text-xs text-muted mt-0.5">{{ q.answers }} answers · {{ q.when }}</p></div></li>
        </ul>

        <div v-else class="space-y-4">
          <div class="rounded-xl border border-default p-4 flex items-start gap-3"><UIcon :name="p.safety === 'passed' ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'" class="size-5 mt-0.5" :class="p.safety === 'passed' ? 'text-success' : 'text-warning'" /><div><p class="text-sm font-semibold text-highlighted">{{ p.safety === 'passed' ? 'Passed the automatic check' : 'Read this one carefully' }}</p><p class="text-sm text-muted mt-0.5">{{ p.safety === 'passed' ? 'No keys, hidden text or look-alike links were found in the text.' : 'The automatic check found something worth a second look in the instructions.' }}</p></div></div>
          <ul class="rounded-xl border border-default divide-y divide-default overflow-hidden"><li v-for="u in p.uses" :key="u.app" class="flex items-center gap-3 px-4 py-3"><UIcon :name="u.icon" class="size-5" /><p class="text-sm text-highlighted">{{ u.app }}</p><span class="ml-auto text-xs text-muted">Asks before it changes anything</span></li></ul>
        </div>
      </div>

      <!-- Sidebar -->
      <aside class="space-y-6 text-sm">
        <section>
          <h2 class="font-semibold text-highlighted mb-2">About</h2>
          <p class="text-default">{{ p.blurb }}</p>
          <div class="flex flex-wrap gap-1.5 mt-3"><UBadge v-for="t in p.tags" :key="t" :label="t" color="primary" variant="subtle" size="sm" /></div>
          <ul class="mt-4 space-y-2 text-muted">
            <li class="flex items-center gap-2"><UIcon name="i-lucide-star" class="size-4" /><b class="text-highlighted">{{ fmt(p.stars) }}</b> stars</li>
            <li class="flex items-center gap-2"><UIcon name="i-lucide-git-fork" class="size-4" /><b class="text-highlighted">{{ fmt(p.forks) }}</b> forks</li>
            <li class="flex items-center gap-2"><UIcon name="i-lucide-scale" class="size-4" />{{ p.licence }} licence</li>
            <li class="flex items-center gap-2" :class="p.safety === 'passed' ? 'text-success' : 'text-warning'"><UIcon :name="p.safety === 'passed' ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'" class="size-4" />{{ p.safety === 'passed' ? 'Passed the check' : 'Needs a careful read' }}</li>
          </ul>
        </section>

        <section>
          <h2 class="font-semibold text-highlighted mb-2">Works with</h2>
          <ul class="space-y-2"><li v-for="u in p.uses" :key="u.app" class="flex items-center gap-2 text-default"><UIcon :name="u.icon" class="size-4" />{{ u.app }}</li></ul>
        </section>

        <section>
          <h2 class="font-semibold text-highlighted mb-2">Versions <span class="text-muted font-normal">{{ p.versions.length }}</span></h2>
          <ul class="space-y-2.5">
            <li v-for="v in p.versions.slice(0, 2)" :key="v.tag" class="flex items-start gap-2"><UIcon name="i-lucide-tag" class="size-4 mt-0.5 text-success" /><div class="min-w-0"><p class="font-medium text-highlighted">{{ v.tag }} <UBadge v-if="v.latest" label="Latest" color="success" variant="subtle" size="sm" /></p><p class="text-xs text-muted">{{ v.when }}</p></div></li>
          </ul>
        </section>

        <section>
          <h2 class="font-semibold text-highlighted mb-2">Made of</h2>
          <div class="flex h-2 overflow-hidden rounded-full"><span v-for="m in p.made" :key="m.label" :class="m.dot" :style="{ width: `${m.pct}%` }" /></div>
          <ul class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs"><li v-for="m in p.made" :key="m.label" class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" :class="m.dot" /><b class="text-highlighted">{{ m.label }}</b><span class="text-muted">{{ m.pct }}%</span></li></ul>
        </section>

        <section>
          <h2 class="font-semibold text-highlighted mb-2">Maker</h2>
          <div class="flex items-center gap-2.5"><ReefAvatar :name="owner.name" :size="32" /><div class="leading-tight"><ReefName :person="owner" :handle="false" /><p class="text-xs text-muted">@{{ owner.handle }}</p></div></div>
        </section>
      </aside>
    </div>
  </ReefShell>
  <ReefShell v-else wide title="Not found" back>
    <div class="py-28 text-center px-6"><UIcon name="i-lucide-waves" class="size-10 text-muted mx-auto mb-3" /><p class="text-lg font-semibold text-highlighted">Nothing here</p><p class="text-sm text-muted mt-1">This project does not exist, or it was removed.</p></div>
  </ReefShell>
</template>
