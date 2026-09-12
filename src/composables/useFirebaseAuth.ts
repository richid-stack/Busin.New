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
  onAuthStateChanged,
  type User
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'

export const useFirebaseAuth = createSharedComposable(() => {
  const firebaseUser = ref<User | null>(auth.currentUser)
  const loading = ref<boolean>(false)
  const authReady = ref<boolean>(false)
  const error = ref<string | null>(null)
  const isAuthModalOpen = ref<boolean>(false)
  const { csrf, headerName } = useCsrf()

  const syncServerSession = async (user: User | null) => {
    try {
      if (user) {
        await $fetch('/api/session', {
          method: 'POST',
          headers: { [headerName]: csrf() },
          body: {
            user: {
              id: user.uid,
              name: user.displayName || user.email?.split('@')[0] || 'User',
              avatar: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
              username: user.displayName || user.email?.split('@')[0] || 'user',
              email: user.email || ''
            }
          }
        })
      } else {
        await $fetch('/api/session', {
          method: 'DELETE',
          headers: { [headerName]: csrf() }
        }).catch(() => {})
      }
    } catch (e) {
      console.error('Failed to sync session with server:', e)
    }
  }

  // Initialize listener
  onAuthStateChanged(auth, async (u) => {
    firebaseUser.value = u
    authReady.value = true
    await syncServerSession(u)
  })

  const openAuthModal = () => {
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
    loading,
    authReady,
    error,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    signInWithGoogle,
    signInWithGithub,
    signInWithEmail,
    signUpWithEmail,
    signOutUser,
    isAuthenticated: computed(() => Boolean(firebaseUser.value))
  }
})
