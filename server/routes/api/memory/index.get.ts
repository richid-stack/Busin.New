import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { isMemoryEnabled, listMemories } from '../../../services/memory/store'
import { MAX_MEMORIES, MAX_MEMORY_CHARS } from '../../../services/memory/memory'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const [enabled, items] = await Promise.all([isMemoryEnabled(user.id), listMemories(user.id)])
  return { enabled, items, limits: { maxItems: MAX_MEMORIES, maxChars: MAX_MEMORY_CHARS } }
})
