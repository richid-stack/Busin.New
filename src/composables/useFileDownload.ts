import { ref } from 'vue'

/** Downloads a file OpenLobs created. The request carries the sign-in token, so it cannot be a plain link. */
export function useFileDownload(getFile: () => { fileId?: string, name?: string }) {
  const loading = ref(false)
  const error = ref('')

  async function download() {
    const { fileId, name } = getFile()
    if (!fileId || loading.value) return
    loading.value = true
    error.value = ''
    let url = ''
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`)
      if (!res.ok) {
        error.value = res.status === 404 ? 'This file has expired or is no longer available.' : 'The download failed. Please try again.'
        return
      }
      url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name || 'file'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      error.value = 'The download failed. Check your connection and try again.'
    } finally {
      // Give the browser a moment to start the save before releasing the file.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
      loading.value = false
    }
  }

  return { loading, error, download }
}
