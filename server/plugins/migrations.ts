import { mkdir } from 'node:fs/promises'
import { definePlugin } from 'nitro'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { useDrizzle } from '../utils/drizzle'

export default definePlugin(async () => {
  if (!import.meta.dev) {
    return
  }

  try {
    await mkdir('.data', { recursive: true })

    await migrate(useDrizzle(), {
      migrationsFolder: 'server/database/migrations'
    })
  } catch (error) {
    console.warn('[AI Studio] Database migration warning:', error)
  }
})
