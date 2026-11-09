import type { UIMessage } from 'ai'

type Part = { type: string, [key: string]: any }

export interface AttachedFile {
  filename: string
  mediaType: string
  url: string
}

const isDataUrl = (url: unknown): url is string => typeof url === 'string' && /^data:/i.test(url)
const isFilePart = (part: Part) => part?.type === 'file'
const isImage = (part: Part) => String(part.mediaType ?? '').toLowerCase().startsWith('image/')

/** Approximate size in KB of the file inside a data URL. */
function sizeKb(url: string): number {
  const comma = url.indexOf(',')
  const payload = comma < 0 ? '' : url.slice(comma + 1)
  return Math.max(1, Math.round((/;base64,/i.test(url.slice(0, comma + 1)) ? payload.length * 3 / 4 : payload.length) / 1024))
}

/** Documents the read_document tool can open: every uploaded file that is not a picture. */
export function listDocuments(messages: UIMessage[]): AttachedFile[] {
  const out: AttachedFile[] = []
  for (const message of messages) {
    for (const part of (message.parts ?? []) as Part[]) {
      if (isFilePart(part) && !isImage(part) && isDataUrl(part.url)) {
        out.push({ filename: String(part.filename || 'attachment'), mediaType: String(part.mediaType || ''), url: part.url })
      }
    }
  }
  return out
}

/** Pictures attached to the conversation, newest last. */
export function listImages(messages: UIMessage[]): AttachedFile[] {
  const out: AttachedFile[] = []
  for (const message of messages) {
    for (const part of (message.parts ?? []) as Part[]) {
      if (isFilePart(part) && isImage(part) && isDataUrl(part.url)) {
        out.push({ filename: String(part.filename || 'image'), mediaType: String(part.mediaType || ''), url: part.url })
      }
    }
  }
  return out
}

/** The most recent attached picture with this name, or the latest picture when no name is given. */
export function findImage(messages: UIMessage[], name?: string): AttachedFile | undefined {
  const images = listImages(messages).reverse()
  if (!name?.trim()) return images[0]
  return images.find(f => f.filename.toLowerCase() === name.trim().toLowerCase())
}

/** The most recent attached file with this name (case-insensitive), or undefined. */
export function findDocument(messages: UIMessage[], name: string): AttachedFile | undefined {
  const wanted = name.trim().toLowerCase()
  return listDocuments(messages).reverse().find(f => f.filename.toLowerCase() === wanted)
}

/**
 * Prepares messages for the model.
 * - A file part must be an uploaded file (a data: URL). Anything else, such as an http address, is
 *   replaced, because the AI SDK would otherwise download it from the server on the caller's behalf.
 * - PDFs stay as they are for models that read them natively. Every other document becomes a short
 *   note telling the model to use read_document, so it never receives a file type it cannot handle.
 */
export function prepareMessagesForModel(messages: UIMessage[], options: { nativePdf: boolean }): UIMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.parts) || !message.parts.some(p => isFilePart(p as Part))) return message
    const parts = (message.parts as Part[]).map((part): Part => {
      if (!isFilePart(part)) return part
      if (!isDataUrl(part.url)) {
        return { type: 'text', text: '[An attachment was removed because it was not an uploaded file.]' }
      }
      const mediaType = String(part.mediaType ?? '').toLowerCase()
      if (isImage(part)) return part
      if (mediaType === 'application/pdf' && options.nativePdf) return part
      const name = String(part.filename || 'attachment')
      return { type: 'text', text: `[The user attached the file "${name}" (${sizeKb(part.url)} KB). Read it with the read_document tool, using the file name "${name}".]` }
    })
    return { ...message, parts: parts as UIMessage['parts'] }
  })
}

/** Providers whose models read PDF files directly. */
export const supportsNativePdf = (modelId: string) => /^(google|anthropic|openai)\//.test(modelId)
