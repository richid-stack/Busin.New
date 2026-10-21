import { ref, computed, onBeforeUnmount } from 'vue'
import { fitImage, encodedSize } from '../utils/image'
import { fileToDataUrl } from '../utils/files'

// Chat messages are stored one document each (1 MiB limit server side), so everything attached to one
// message has to fit in roughly 800 KB once base64-encoded.
const MAX_FILES = 5
const MAX_TOTAL_ENCODED = 800_000
const ACCEPTED = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/plain)$/

export interface PromptAttachment {
  file: File
  /** Object URL for image previews, empty for other files. */
  url: string
}

export function usePromptAttachments() {
  const toast = useToast()
  const attachments = ref<PromptAttachment[]>([])
  const processing = ref(false)

  const totalEncoded = computed(() => attachments.value.reduce((sum, a) => sum + encodedSize(a.file.size), 0))

  function reject(description: string) {
    toast.add({ description, icon: 'i-lucide-paperclip', color: 'warning' })
  }

  async function addFiles(files: FileList | File[] | null | undefined) {
    if (!files || !files.length) return
    processing.value = true

    try {
      for (const original of Array.from(files)) {
        if (attachments.value.length >= MAX_FILES) {
          reject(`You can attach up to ${MAX_FILES} files per message.`)
          break
        }
        if (!ACCEPTED.test(original.type)) {
          reject(`${original.name} isn't supported. Attach images, PDFs or plain text files.`)
          continue
        }

        const remaining = MAX_TOTAL_ENCODED - totalEncoded.value
        let file: File | null = original

        if (original.type.startsWith('image/')) {
          file = await fitImage(original, remaining).catch(() => null)
        } else if (encodedSize(original.size) > remaining) {
          file = null
        }

        if (!file) {
          reject(`${original.name} is too large to attach. Try a smaller file.`)
          continue
        }

        attachments.value.push({
          file,
          url: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
        })
      }
    } finally {
      processing.value = false
    }
  }

  async function onInputChange(e: Event) {
    const target = e.target as HTMLInputElement
    await addFiles(target.files)
    target.value = ''
  }

  function remove(index: number) {
    const item = attachments.value[index]
    if (item?.url) URL.revokeObjectURL(item.url)
    attachments.value.splice(index, 1)
  }

  function clear() {
    attachments.value.forEach(a => a.url && URL.revokeObjectURL(a.url))
    attachments.value = []
  }

  /** Files as AI SDK file parts (what `sendMessage({ files })` expects). */
  async function toFileParts() {
    return await Promise.all(attachments.value.map(async a => ({
      type: 'file' as const,
      mediaType: a.file.type,
      filename: a.file.name,
      url: await fileToDataUrl(a.file)
    })))
  }

  /** Files in the shape `POST /api/chats` expects. */
  async function toApiAttachments() {
    return await Promise.all(attachments.value.map(async a => ({
      name: a.file.name,
      contentType: a.file.type,
      url: await fileToDataUrl(a.file)
    })))
  }

  onBeforeUnmount(clear)

  return { attachments, processing, addFiles, onInputChange, remove, clear, toFileParts, toApiAttachments }
}
