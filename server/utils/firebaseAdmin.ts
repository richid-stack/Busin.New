import { initializeApp, getApps, applicationDefault, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Public Firebase web config (projectId, firestoreDatabaseId...). Contains no secrets.
function loadFirebaseConfig(): Record<string, string> {
  try {
    const cwdPath = resolve(process.cwd(), 'firebase-applet-config.json')
    if (existsSync(cwdPath)) {
      return JSON.parse(readFileSync(cwdPath, 'utf-8'))
    }
  } catch {}
  try {
    const relPath = new URL('../../firebase-applet-config.json', import.meta.url)
    if (existsSync(relPath)) {
      return JSON.parse(readFileSync(relPath, 'utf-8'))
    }
  } catch {}
  return {}
}

const config = loadFirebaseConfig()

/**
 * Server-side Firebase Admin app.
 *
 * Credentials come from Application Default Credentials: on Google Cloud (Cloud Run,
 * App Engine, etc.) this is the attached service account; locally set
 * GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.
 */
export function getAdminApp(): App {
  const existing = getApps().find(a => a.name === 'openlobs-admin')
  if (existing) return existing
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || config.projectId
  }, 'openlobs-admin')
}

let dbOverride: ReturnType<typeof getFirestore> | null = null

/** Tests hand in an in-memory stand-in so store code can run without a real project. Pass null to undo. */
export function useFirebaseDbForTests(db: unknown) {
  dbOverride = db as ReturnType<typeof getFirestore> | null
}

export function getFirebaseDb() {
  if (dbOverride) return dbOverride
  return getFirestore(getAdminApp(), config.firestoreDatabaseId || '(default)')
}

let authOverride: ReturnType<typeof getAuth> | null = null

/** Tests hand in a stand-in that "verifies" sign-in tokens, so a route can be called as a signed-in person. Pass null to undo. */
export function useFirebaseAuthForTests(auth: unknown) {
  authOverride = auth as ReturnType<typeof getAuth> | null
}

export function getFirebaseAuth() {
  if (authOverride) return authOverride
  return getAuth(getAdminApp())
}
