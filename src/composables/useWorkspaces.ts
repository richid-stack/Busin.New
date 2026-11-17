import { computed, ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { WhereWeAre, Workspace, WorkspaceDetail, WorkspaceFile, WorkspaceNote, WorkspaceNotes, WorkspacePowers } from '../types/workspaces'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

const messageOf = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || fallback

export const useWorkspaces = createSharedComposable(() => {
  const workspaces = ref<Workspace[]>([])
  const max = ref(8)
  const loaded = ref(false)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const { firebaseUser } = useFirebaseAuth()
  const headers = () => ({ [headerName]: csrf() })

  let generation = 0

  async function fetchWorkspaces() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const res = await $fetch<{ workspaces: Workspace[], max: number }>('/api/workspaces', { headers: headers() })
      if (mine !== generation) return
      workspaces.value = res.workspaces ?? []
      max.value = res.max ?? max.value
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) workspaces.value = []
      else loadError.value = messageOf(err, 'Could not load your workspaces.')
    } finally {
      if (mine === generation) { loading.value = false; loaded.value = true }
    }
  }

  const replace = (w: Workspace) => { workspaces.value = workspaces.value.map(x => x.id === w.id ? w : x) }

  async function createWorkspace(input: { name: string, instructions?: string, icon?: string }): Promise<Workspace> {
    const w = await $fetch<Workspace>('/api/workspaces', { method: 'POST', headers: headers(), body: input })
    workspaces.value = [w, ...workspaces.value]
    return w
  }

  async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'name' | 'instructions' | 'icon' | 'useMemory' | 'agentId' | 'pinned'>> & { powers?: Partial<WorkspacePowers> }): Promise<Workspace> {
    const w = await $fetch<Workspace>(`/api/workspaces/${id}`, { method: 'PATCH', headers: headers(), body: patch })
    replace(w)
    return w
  }

  async function removeWorkspace(id: string) {
    await $fetch(`/api/workspaces/${id}`, { method: 'DELETE', headers: headers() })
    workspaces.value = workspaces.value.filter(w => w.id !== id)
  }

  const detail = (id: string) => $fetch<WorkspaceDetail>(`/api/workspaces/${id}`, { headers: headers() })

  const addText = (id: string, name: string, text: string) =>
    $fetch<WorkspaceFile>(`/api/workspaces/${id}/files`, { method: 'POST', headers: headers(), body: { name, text } })

  const addUpload = (id: string, name: string, url: string) =>
    $fetch<WorkspaceFile>(`/api/workspaces/${id}/files`, { method: 'POST', headers: headers(), body: { name, url } })

  const removeFile = (id: string, fileId: string) =>
    $fetch(`/api/workspaces/${id}/files/${fileId}`, { method: 'DELETE', headers: headers() })

  const fetchNotes = (id: string) => $fetch<WorkspaceNotes>(`/api/workspaces/${id}/notes`, { headers: headers() })

  const addNote = (id: string, text: string) =>
    $fetch<WorkspaceNote>(`/api/workspaces/${id}/notes`, { method: 'POST', headers: headers(), body: { text } })

  const removeNote = (id: string, noteId: string) =>
    $fetch(`/api/workspaces/${id}/notes/${noteId}`, { method: 'DELETE', headers: headers() })

  const saveWhereWeAre = (id: string, text: string) =>
    $fetch<{ whereWeAre: WhereWeAre | null }>(`/api/workspaces/${id}/where-we-are`, { method: 'PUT', headers: headers(), body: { text } })

  const addGithub = (id: string, repo: string) =>
    $fetch<WorkspaceFile>(`/api/workspaces/${id}/github`, { method: 'POST', headers: headers(), body: { repo } })

  const addReef = (id: string, owner: string, name: string) =>
    $fetch<{ workspace: Workspace, file: WorkspaceFile | null, agent: { id: string, name: string } }>(`/api/workspaces/${id}/reef`, { method: 'POST', headers: headers(), body: { owner, name } })

  /** Moves a chat into a workspace (null: out of any) and/or switches its agent. */
  const linkChat = (chatId: string, link: { workspaceId?: string | null, agentId?: string | null }) =>
    $fetch<{ workspaceId: string | null, agentId: string | null }>(`/api/chats/link/${chatId}`, { method: 'PATCH', headers: headers(), body: link })

  // A different account must never see the previous account's workspaces.
  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    workspaces.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
  })

  const pinned = computed(() => workspaces.value.filter(w => w.pinned))
  const getWorkspace = (id: string | null | undefined) => (id ? workspaces.value.find(w => w.id === id) : undefined)

  return { workspaces, pinned, max, loaded, loading, loadError, fetchWorkspaces, createWorkspace, updateWorkspace, removeWorkspace, detail, addText, addUpload, removeFile, fetchNotes, addNote, removeNote, saveWhereWeAre, addGithub, addReef, linkChat, getWorkspace, messageOf }
})
