import { safeFileName } from '../files/store'
import { buildArtifactFile, buildProjectPage } from './model'
import type { ProjectSpec } from './model'
import { getArtifact } from './store'

/**
 * The file for the version being shown, built fresh so it always matches what is on screen. Null when it is not the
 * person's or has expired. A project can also come as one web page (`as: 'html'`); when its scripts need a package or a
 * missing file that cannot be done, and the reason comes back instead.
 */
export async function downloadArtifact(userId: string, id: string, as?: 'html'): Promise<{ name: string, mime: string, bytes: Uint8Array } | { problem: string } | null> {
  const file = await getArtifact(userId, id)
  if (!file) return null
  if (as === 'html') {
    if (file.kind !== 'project') return { problem: 'Only a project can be saved as one page.' }
    const page = buildProjectPage(file.spec as ProjectSpec)
    if ('problem' in page) return page
    return { name: safeFileName(file.title, 'html'), mime: 'text/html; charset=utf-8', bytes: page.bytes }
  }
  const built = await buildArtifactFile(file.kind, file.format, file.spec)
  return { name: safeFileName(file.title, file.format), mime: built.mime, bytes: built.bytes }
}
