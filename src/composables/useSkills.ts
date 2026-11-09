import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { KeptSkillView, SkillLimits } from '../types/skills'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

/** The skills the person chose to keep for all chats. */
export const useSkills = createSharedComposable(() => {
  const skills = ref<KeptSkillView[]>([])
  const limits = ref<SkillLimits>({ skills: 10 })
  const loading = ref(false)
  const loaded = ref(false)
  const unauthorized = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const { firebaseUser } = useFirebaseAuth()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  let generation = 0

  async function fetchSkills() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const res = await $fetch<{ skills: KeptSkillView[], limits: SkillLimits }>('/api/skills', { headers: headers() })
      if (mine !== generation) return
      skills.value = res.skills ?? []
      limits.value = res.limits ?? limits.value
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        skills.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your skills.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  async function removeSkill(name: string) {
    await $fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE', headers: headers() })
    skills.value = skills.value.filter(s => s.name !== name)
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    skills.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  return { skills, limits, loading, loaded, unauthorized, loadError, fetchSkills, removeSkill }
})
