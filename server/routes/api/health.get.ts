import { defineHandler } from 'nitro'

/** For Cloud Run's startup check and uptime monitors. It does not touch the database on purpose. */
export default defineHandler((event) => {
  event.res.headers.set('Cache-Control', 'no-store')
  return { ok: true, service: 'openlobs', revision: process.env.K_REVISION || 'dev' }
})
