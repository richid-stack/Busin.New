const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Browsers often label CSV, Markdown and JSON files wrongly (or not at all), so the extension decides.
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX,
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  txt: 'text/plain'
}

/** Value for <input accept>. */
export const ATTACH_ACCEPT = `image/png,image/jpeg,image/webp,image/gif,${Object.keys(BY_EXTENSION).map(e => `.${e}`).join(',')}`

export const ATTACH_HELP = 'images, PDFs, Word (.docx), CSV, Markdown, JSON or text files'

const IMAGE = /^image\/(png|jpe?g|webp|gif)$/

/** Returns the file with a trustworthy type, or null when it is not a kind of file the chat can use. */
export function resolveAttachment(file: File): File | null {
  if (IMAGE.test(file.type)) return file
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const type = BY_EXTENSION[ext]
  if (!type) return null
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified })
}

/** Icon for an attached document, by media type. */
export function attachmentIcon(mediaType: string | undefined): string {
  if (mediaType === 'application/pdf') return 'i-lucide-file-text'
  if (mediaType === 'text/csv') return 'i-lucide-file-spreadsheet'
  if (mediaType === DOCX) return 'i-lucide-file-type'
  return 'i-lucide-file'
}
