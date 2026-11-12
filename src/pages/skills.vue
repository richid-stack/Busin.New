<script setup lang="ts">
import PageSkeleton from '../components/state/PageSkeleton.vue'
import StateCard from '../components/state/StateCard.vue'
import { computed, defineAsyncComponent, onMounted, watch } from 'vue'
import { useSkills } from '../composables/useSkills'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'
import type { KeptSkillView } from '../types/skills'

const ModalConfirm = defineAsyncComponent(() => import('../components/ModalConfirm.vue'))

const toast = useToast()
const overlay = useOverlay()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { skills, limits, loading, loaded, unauthorized, loadError, fetchSkills, removeSkill } = useSkills()

onMounted(fetchSkills)
// The server's own session decides what it will answer, so load (again) once that session exists.
watch(loggedIn, fetchSkills)

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback
const isEmpty = computed(() => loaded.value && !loading.value && !unauthorized.value && !loadError.value && skills.value.length === 0)
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }

const deleteModal = overlay.create(ModalConfirm)
async function remove(skill: KeptSkillView) {
  const confirmed = await deleteModal.open({
    title: `Remove "${skill.name}"?`,
    description: 'OpenLobs stops following it in every chat. You can ask for it again any time.',
    confirmLabel: 'Remove',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await removeSkill(skill.name)
    toast.add({ title: 'Skill removed', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not remove the skill', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const PILLARS = [
  { icon: 'i-lucide-message-square-plus', title: 'Ask in a chat', detail: 'Say "keep this skill" with a link to it. OpenLobs reads it and asks you first.' },
  { icon: 'i-lucide-shield-check', title: 'Checked before it is kept', detail: 'A skill that tries to trick the assistant is refused, and anything odd is shown to you.' },
  { icon: 'i-lucide-infinity', title: 'Works in every chat', detail: 'A kept skill is there next time too. Remove it here whenever you like.' }
]
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <RouterLink to="/settings" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-default mb-6 focus-visible:outline-2 focus-visible:outline-primary rounded">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        Settings
      </RouterLink>

      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Your skills</h1>
        <p class="text-muted text-base md:text-lg">Skills you chose to keep, ready in every chat.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        <div v-for="pillar in PILLARS" :key="pillar.title" class="rounded-2xl border border-default bg-elevated/40 p-4">
          <div class="size-8 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center mb-3">
            <UIcon :name="pillar.icon" class="size-4 text-primary" />
          </div>
          <h3 class="text-sm font-semibold text-highlighted mb-1">{{ pillar.title }}</h3>
          <p class="text-xs text-muted leading-relaxed">{{ pillar.detail }}</p>
        </div>
      </div>

      <StateCard v-if="unauthorized" icon="i-lucide-lock" title="Sign in to see your skills" text="Kept skills belong to your account.">
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </StateCard>

      <StateCard v-else-if="loadError" icon="i-lucide-cloud-off" title="Could not load your skills" :text="loadError">
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchSkills" />
      </StateCard>

      <PageSkeleton v-else-if="!loaded" shape="rows" />

      <StateCard v-else-if="isEmpty" icon="i-lucide-book-open-text" title="No kept skills yet" text="In a chat, ask OpenLobs to keep a skill from a link. It shows up here once you approve it." kind="empty">
        <UButton label="Start a chat" icon="i-lucide-message-square" color="neutral" to="/" />
      </StateCard>

      <div v-else class="flex flex-col gap-4">
        <div v-for="skill in skills" :key="skill.name" class="rounded-2xl border border-default bg-default p-5 hover:shadow-md transition-shadow">
          <div class="flex items-start gap-4">
            <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default shrink-0">
              <UIcon name="i-lucide-book-open-text" class="size-5 text-primary" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 mb-0.5">
                <h3 class="text-sm font-semibold text-highlighted truncate">{{ skill.name }}</h3>
                <UBadge v-if="skill.warnings.length" label="Has notes" color="warning" variant="subtle" size="sm" />
              </div>
              <p class="text-sm text-muted leading-snug">{{ skill.description }}</p>
              <p class="text-xs text-dimmed mt-2 truncate">From {{ skill.source }}<span v-if="when(skill.installedAt)"> · kept {{ when(skill.installedAt) }}</span></p>
            </div>
          </div>

          <div v-if="skill.warnings.length" class="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/20 p-3.5 bg-gradient-to-b from-amber-400/20 to-orange-400/20 dark:from-amber-500/10 dark:to-orange-500/10">
            <UIcon name="i-lucide-triangle-alert" class="size-4 mt-0.5 text-warning shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">Noted when it was checked</p>
              <p class="text-sm text-default leading-snug mt-0.5">{{ skill.warnings.join(' ') }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2 mt-4 pt-4 border-t border-default">
            <UButton label="Remove" icon="i-lucide-trash" size="sm" color="error" variant="ghost" class="ml-auto" @click="remove(skill)" />
          </div>
        </div>
      </div>

      <p v-if="loaded && skills.length" class="text-xs text-muted mt-4">{{ skills.length }} of {{ limits.skills }} skills kept</p>
    </div>
  </div>
</template>
