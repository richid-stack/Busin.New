import { ref, computed } from 'vue'
import type { ArtifactView, PartSelection } from '../types/artifacts'
import { useCsrf } from './useCsrf'

/** The file open beside the chat. One at a time, shared by the chat page and the cards in the chat. */
const openId = ref<string | null>(null)
const file = ref<ArtifactView | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const selection = ref<PartSelection | null>(null)
const sheet = ref(1)
const downloading = ref(false)
let generation = 0

const messageFor = (status: number | undefined, fallback: string) => status === 404 ? 'This file has expired or is no longer available.' : fallback

export function useWorkPane() {
  const { csrf, headerName } = useCsrf()

  async function load(id: string) {
    const mine = ++generation
    loading.value = !file.value || file.value.id !== id
    error.value = ''
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
      if (mine !== generation) return
      if (!res.ok) { error.value = messageFor(res.status, 'Could not open the file. Try again.'); if (res.status === 404) file.value = null; return }
      const next = await res.json() as ArtifactView
      if (mine !== generation) return
      file.value = next
      const spec = next.spec as any
      const count = next.kind === 'document' ? spec.blocks.length : next.kind === 'presentation' ? spec.slides.length : next.kind === 'page' || next.kind === 'project' ? 1 : (spec.sheets[Math.min(sheet.value, spec.sheets.length) - 1]?.rows.length ?? 0)
      if (selection.value && selection.value.to > count) selection.value = null
      if (next.kind === 'workbook') sheet.value = Math.min(sheet.value, (next.spec as any).sheets.length)
    } catch {
      if (mine === generation) error.value = 'Could not open the file. Check your connection and try again.'
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function open(id: string) {
    if (openId.value !== id) { selection.value = null; sheet.value = 1; file.value = null }
    openId.value = id
    await load(id)
  }

  function close() {
    generation++
    openId.value = null
    file.value = null
    selection.value = null
    error.value = ''
    loading.value = false
  }

  /** Shows what the file looks like now, for example after the assistant changed it. */
  const refresh = () => (openId.value ? load(openId.value) : Promise.resolve())

  /** Undo and redo: step to another version. */
  async function move(version: number) {
    const id = openId.value
    if (!id || busy.value) return
    busy.value = true
    error.value = ''
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [headerName]: csrf() },
        body: JSON.stringify({ version })
      })
      if (!res.ok) { error.value = messageFor(res.status, 'Could not go to that version. Try again.'); return }
      if (openId.value === id) { file.value = await res.json() as ArtifactView; selection.value = null }
    } catch {
      error.value = 'Could not go to that version. Check your connection and try again.'
    } finally {
      busy.value = false
    }
  }

  /** Saves the file. A project comes as a .zip, or as one web page (`as: 'html'`). */
  async function download(as?: 'html') {
    const f = file.value
    if (!f || downloading.value) return
    downloading.value = true
    error.value = ''
    let url = ''
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(f.id)}/download${as ? `?as=${as}` : ''}`)
      if (!res.ok) {
        // A project that cannot be made into one page says why (for example, a script needs a package).
        const body = res.status === 422 ? await res.json().catch(() => null) as { statusMessage?: string, message?: string } | null : null
        error.value = body?.statusMessage || body?.message || messageFor(res.status, 'The download failed. Please try again.')
        return
      }
      url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${f.title}.${as ?? f.format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      error.value = 'The download failed. Check your connection and try again.'
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
      downloading.value = false
    }
  }

  const select = (next: PartSelection | null) => { selection.value = next }

  /** What the chat sends along so the assistant knows which file is open and which part was picked. */
  const forChat = computed(() => (openId.value && file.value ? { artifactId: openId.value, ...(selection.value ? { selection: selection.value } : {}) } : undefined))

  return { openId, file, loading, busy, error, selection, sheet, downloading, forChat, open, close, refresh, move, download, select }
}
