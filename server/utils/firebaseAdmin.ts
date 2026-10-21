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

export function getFirebaseDb() {
  return getFirestore(getAdminApp(), config.firestoreDatabaseId || '(default)')
}

export function getFirebaseAuth() {
  return getAuth(getAdminApp())
}
