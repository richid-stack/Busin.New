import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import config from '../../firebase-applet-config.json'

const app = getApps().length > 0 ? getApp() : initializeApp(config)
export const auth = getAuth(app)
export const db = getFirestore(app, config.firestoreDatabaseId || '(default)')

// Only for the automatic browser checks on GitHub: they use Google's local test emulators, never real accounts.
// Nothing sets these in a normal build, so this does nothing there.
if (import.meta.env.VITE_AUTH_EMULATOR_URL) {
  connectAuthEmulator(auth, import.meta.env.VITE_AUTH_EMULATOR_URL, { disableWarnings: true })
  if (import.meta.env.VITE_FIRESTORE_EMULATOR_HOST) {
    const [host, port] = String(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST).split(':')
    connectFirestoreEmulator(db, host!, Number(port))
  }
}
export default app
