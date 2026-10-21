<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'

const {
  isAuthModalOpen,
  authModalMode,
  signInWithGoogle,
  signInWithGithub,
  signInWithEmail,
  signUpWithEmail,
  sendPasswordReset,
  loading,
  error
} = useFirebaseAuth()

const { fetchSession } = useUserSession()

const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const displayName = ref('')
const formError = ref<string | null>(null)
const resetSent = ref(false)

// Never leave credentials sitting in component state once the dialog is closed.
watch(isAuthModalOpen, (open) => {
  if (open) {
    mode.value = authModalMode.value
  } else {
    password.value = ''
    formError.value = null
    resetSent.value = false
  }
})

async function handleForgotPassword() {
  formError.value = null
  resetSent.value = false
  if (!email.value.trim()) {
    formError.value = 'Enter your email above, then choose "Forgot password?" again.'
    return
  }
  try {
    await sendPasswordReset(email.value)
    resetSent.value = true
  } catch (err: unknown) {
    formError.value = error.value || (err as { message?: string }).message || 'Could not send the reset email'
  }
}

async function handleGoogle() {
  formError.value = null
  try {
    await signInWithGoogle()
    await fetchSession()
  } catch (err: unknown) {
    const e = err as { message?: string }
    formError.value = e.message || 'Google sign-in failed'
  }
}

async function handleGithub() {
  formError.value = null
  try {
    await signInWithGithub()
    await fetchSession()
  } catch (err: unknown) {
    const e = err as { message?: string }
    formError.value = e.message || 'GitHub sign-in failed'
  }
}

async function handleSubmit() {
  formError.value = null
  if (!email.value || !password.value) {
    formError.value = 'Please enter both email and password'
    return
  }

  try {
    if (mode.value === 'signup') {
      await signUpWithEmail(email.value, password.value, displayName.value)
    } else {
      await signInWithEmail(email.value, password.value)
    }
    await fetchSession()
    email.value = ''
    password.value = ''
    displayName.value = ''
  } catch (err: unknown) {
    const e = err as { message?: string }
    formError.value = error.value || e.message || 'Authentication failed'
    password.value = ''
  }
}
</script>

<template>
  <UModal
    v-model:open="isAuthModalOpen"
    :title="mode === 'signin' ? 'Welcome back' : 'Create an account'"
    :description="mode === 'signin' ? 'Sign in to access your chat history and synced preferences' : 'Sign up to start chatting and save conversations'"
    :ui="{
      content: 'sm:max-w-md'
    }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-center gap-2 -mt-1 mb-1">
          <img src="/favicon.svg" alt="" class="size-7">
          <span class="text-lg font-bold tracking-tight text-highlighted">OpenLobs</span>
        </div>

        <!-- Social Providers -->
        <div class="flex flex-col gap-2.5">
          <UButton
            icon="i-logos-google-icon"
            label="Continue with Google"
            color="neutral"
            variant="outline"
            size="lg"
            block
            :loading="loading"
            @click="handleGoogle"
          />

          <UButton
            icon="i-simple-icons:github"
            label="Continue with GitHub"
            color="neutral"
            variant="outline"
            size="lg"
            block
            :loading="loading"
            @click="handleGithub"
          />
        </div>

        <!-- Divider -->
        <div class="relative my-2 flex items-center justify-center">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-default" />
          </div>
          <span class="relative bg-default px-3 text-xs uppercase tracking-wider text-muted font-medium">
            or with email
          </span>
        </div>

        <!-- Email & Password Form -->
        <form
          class="flex flex-col gap-3"
          @submit.prevent="handleSubmit"
        >
          <UFormField
            v-if="mode === 'signup'"
            label="Name"
          >
            <UInput
              v-model="displayName"
              placeholder="Your name"
              size="md"
              class="w-full"
              :disabled="loading"
            />
          </UFormField>

          <UFormField
            label="Email"
            required
          >
            <UInput
              v-model="email"
              type="email"
              placeholder="name@example.com"
              size="md"
              class="w-full"
              required
              :disabled="loading"
            />
          </UFormField>

          <UFormField
            label="Password"
            required
          >
            <UInput
              v-model="password"
              type="password"
              placeholder="••••••••"
              size="md"
              class="w-full"
              required
              :disabled="loading"
            />
          </UFormField>

          <button
            v-if="mode === 'signin'"
            type="button"
            class="self-end -mt-1 text-xs text-muted hover:text-highlighted hover:underline cursor-pointer"
            :disabled="loading"
            @click="handleForgotPassword"
          >
            Forgot password?
          </button>

          <div
            v-if="resetSent"
            class="rounded-lg bg-success/10 p-3 text-xs text-success border border-success/20"
            role="status"
          >
            If an account exists for {{ email }}, a reset link is on its way.
          </div>

          <!-- Error Feedback -->
          <div
            v-if="formError || error"
            class="rounded-lg bg-error/10 p-3 text-xs text-error border border-error/20"
          >
            {{ formError || error }}
          </div>

          <UButton
            type="submit"
            :label="mode === 'signin' ? 'Sign In' : 'Create Account'"
            color="primary"
            size="md"
            block
            class="mt-1"
            :loading="loading"
          />
        </form>

        <!-- Toggle Mode -->
        <div class="text-center text-xs text-muted mt-2">
          <span v-if="mode === 'signin'">
            Don't have an account?
            <button
              type="button"
              class="text-primary font-medium hover:underline ml-1 cursor-pointer"
              @click="mode = 'signup'; formError = null; resetSent = false"
            >
              Sign up
            </button>
          </span>
          <span v-else>
            Already have an account?
            <button
              type="button"
              class="text-primary font-medium hover:underline ml-1 cursor-pointer"
              @click="mode = 'signin'; formError = null; resetSent = false"
            >
              Sign in
            </button>
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>
