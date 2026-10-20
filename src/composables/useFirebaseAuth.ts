import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import {
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  type User
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'
import { useUserSession } from './useUserSession'

export const useFirebaseAuth = createSharedComposable(() => {
  const firebaseUser = ref<User | null>(auth.currentUser)
  const loading = ref<boolean>(false)
  const authReady = ref<boolean>(false)
  const error = ref<string | null>(null)
  const isAuthModalOpen = ref<boolean>(false)
  /** Which tab the auth dialog opens on. */
  const authModalMode = ref<'signin' | 'signup'>('signin')
  const { csrf, setCsrf, headerName } = useCsrf()
  const userSession = useUserSession()

  const syncServerSession = async (user: User | null, retries = 2) => {
    try {
      const token = csrf()
      const headers: Record<string, string> = {}
      if (token) {
        headers[headerName] = token
      }
      if (user) {
        const res = await $fetch.raw('/api/session', {
          method: 'POST',
          headers,
        })
        const respCsrf = res.headers.get(headerName)
        if (respCsrf) {
          setCsrf(respCsrf)
        }
        // Whatever signed in (popup, restored session, another tab) the UI must now see the server's identity.
        await userSession.fetchSession()
      } else {
        await $fetch('/api/session', {
          method: 'DELETE',
          headers
        }).catch(() => {})
        userSession.session.value = null
      }
    } catch (e) {
      if (retries > 0) {
        setTimeout(() => syncServerSession(user, retries - 1), 800)
      } else {
        console.warn('Session sync note:', e)
      }
    }
  }

  // Initialize listener
  onAuthStateChanged(auth, async (u) => {
    firebaseUser.value = u
    authReady.value = true
    await syncServerSession(u)
  })

  // Called straight from @click handlers too, so anything but 'signup' (e.g. a MouseEvent) means sign in.
  const openAuthModal = (mode?: unknown) => {
    authModalMode.value = mode === 'signup' ? 'signup' : 'signin'
    error.value = null
    isAuthModalOpen.value = true
  }

  const closeAuthModal = () => {
    isAuthModalOpen.value = false
  }

  const signInWithGoogle = async () => {
    loading.value = true
    error.value = null
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      firebaseUser.value = result.user
      await syncServerSession(result.user)
      isAuthModalOpen.value = false
      return result.user
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/popup-closed-by-user') {
        error.value = 'Sign-in cancelled'
      } else {
        error.value = e.message || 'Failed to sign in with Google'
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  const signInWithGithub = async () => {
    loading.value = true
    error.value = null
    try {
      const provider = new GithubAuthProvider()
      const result = await signInWithPopup(auth, provider)
      firebaseUser.value = result.user
      await syncServerSession(result.user)
      isAuthModalOpen.value = false
      return result.user
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/popup-closed-by-user') {
        error.value = 'Sign-in cancelled'
      } else {
        error.value = e.message || 'Failed to sign in with GitHub'
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  const signInWithEmail = async (email: string, pass: string) => {
    loading.value = true
    error.value = null
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), pass)
      firebaseUser.value = result.user
      await syncServerSession(result.user)
      isAuthModalOpen.value = false
      return result.user
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        error.value = 'Invalid email or password'
      } else if (e.code === 'auth/invalid-email') {
        error.value = 'Invalid email address'
      } else {
        error.value = e.message || 'Failed to sign in'
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  const signUpWithEmail = async (email: string, pass: string, displayName?: string) => {
    loading.value = true
    error.value = null
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), pass)
      if (displayName && displayName.trim()) {
        await updateProfile(result.user, { displayName: displayName.trim() })
      }
      firebaseUser.value = result.user
      await syncServerSession(result.user)
      isAuthModalOpen.value = false
      return result.user
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/email-already-in-use') {
        error.value = 'An account with this email already exists'
      } else if (e.code === 'auth/weak-password') {
        error.value = 'Password should be at least 6 characters'
      } else if (e.code === 'auth/operation-not-allowed') {
        error.value = 'Email/Password sign-in is not enabled in Firebase Console (Authentication > Sign-in method).'
      } else {
        error.value = e.message || 'Failed to create account'
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Sends Firebase's reset email. Resolves the same way for unknown addresses (no account enumeration). */
  const sendPasswordReset = async (email: string) => {
    loading.value = true
    error.value = null
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/invalid-email') {
        error.value = 'Invalid email address'
        throw err
      }
      if (e.code !== 'auth/user-not-found') {
        error.value = e.message || 'Could not send the reset email'
        throw err
      }
    } finally {
      loading.value = false
    }
  }

  /** How this person signs in, for the settings page and for choosing how to confirm it is them. */
  const signInMethod = computed<'google' | 'github' | 'password' | 'other'>(() => {
    const id = firebaseUser.value?.providerData?.[0]?.providerId
    return id === 'google.com' ? 'google' : id === 'github.com' ? 'github' : id === 'password' ? 'password' : 'other'
  })

  /**
   * Confirms it is really them (a fresh sign-in), for actions that cannot be undone. Email accounts
   * give their password; Google and GitHub open their sign-in window again.
   */
  const reauthenticate = async (password?: string) => {
    const user = auth.currentUser
    if (!user) throw new Error('You are signed out. Sign in again first.')
    try {
      if (signInMethod.value === 'password') {
        if (!password) throw Object.assign(new Error('Enter your password to continue.'), { code: 'app/password-needed' })
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email || '', password))
      } else if (signInMethod.value === 'google') {
        await reauthenticateWithPopup(user, new GoogleAuthProvider())
      } else if (signInMethod.value === 'github') {
        await reauthenticateWithPopup(user, new GithubAuthProvider())
      } else {
        throw new Error('Please sign out and sign in again, then retry.')
      }
      // The next request must carry a token that proves the new sign-in.
      await user.getIdToken(true)
    } catch (err: unknown) {
      const e = err as { message?: string, code?: string }
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') throw new Error('That password is not right.')
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') throw new Error('Sign-in was cancelled.')
      if (e.code === 'auth/too-many-requests') throw new Error('Too many attempts. Wait a moment and try again.')
      throw err
    }
  }

  /** Changes the display name and refreshes what the server sees. */
  const updateDisplayName = async (name: string) => {
    const user = auth.currentUser
    if (!user) throw new Error('You are signed out.')
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!clean) throw new Error('A name cannot be empty.')
    await updateProfile(user, { displayName: clean })
    await user.getIdToken(true)
    firebaseUser.value = auth.currentUser
    await syncServerSession(auth.currentUser)
  }

  const signOutUser = async () => {
    loading.value = true
    try {
      await signOut(auth)
      firebaseUser.value = null
      await syncServerSession(null)
    } finally {
      loading.value = false
    }
  }

  return {
    firebaseUser,
    user: firebaseUser,
    loading,
    authReady,
    error,
    isAuthModalOpen,
    authModalMode,
    openAuthModal,
    closeAuthModal,
    signInWithGoogle,
    signInWithGithub,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    signInMethod,
    reauthenticate,
    updateDisplayName,
    signOutUser,
    isAuthenticated: computed(() => Boolean(firebaseUser.value))
  }
})
