import { safeFileName } from '../files/store'
import { buildArtifactFile } from './model'
import { getArtifact } from './store'

/** The file for the version being shown, built fresh so it always matches what is on screen. Null when it is not the person's or has expired. */
export async function downloadArtifact(userId: string, id: string): Promise<{ name: string, mime: string, bytes: Uint8Array } | null> {
  const file = await getArtifact(userId, id)
  if (!file) return null
  const built = await buildArtifactFile(file.kind, file.format, file.spec)
  return { name: safeFileName(file.title, file.format), mime: built.mime, bytes: built.bytes }
}
