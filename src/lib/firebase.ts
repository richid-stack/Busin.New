import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import config from '../../firebase-applet-config.json'

const app = getApps().length > 0 ? getApp() : initializeApp(config)
export const auth = getAuth(app)
export const db = getFirestore(app, config.firestoreDatabaseId || '(default)')
export default app
