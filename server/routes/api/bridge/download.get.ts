import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'

/** Where to get the Windows installer, when this OpenLobs has one to offer (BRIDGE_DOWNLOAD_URL). Never anything but https. */
export default defineHandler(async (event) => {
  await requireUser(event)
  const raw = (process.env.BRIDGE_DOWNLOAD_URL || '').trim()
  try {
    const url = new URL(raw)
    return { url: url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null }
  } catch {
    return { url: null }
  }
})
