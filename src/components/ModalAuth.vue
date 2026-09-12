<script setup lang="ts">
import { ref } from 'vue'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'

const {
  isAuthModalOpen,
  signInWithGoogle,
  signInWithGithub,
  signInWithEmail,
  signUpWithEmail,
  loading,
  error
} = useFirebaseAuth()

const { fetchSession } = useUserSession()

const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const displayName = ref('')
const formError = ref<string | null>(null)

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
            <div class="w-full border-t border-neutral-200 dark:border-neutral-800" />
          </div>
          <span class="relative bg-white dark:bg-neutral-900 px-3 text-xs uppercase tracking-wider text-neutral-500 font-medium">
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

          <!-- Error Feedback -->
          <div
            v-if="formError || error"
            class="rounded-lg bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900"
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
        <div class="text-center text-xs text-neutral-500 mt-2">
          <span v-if="mode === 'signin'">
            Don't have an account?
            <button
              type="button"
              class="text-primary font-medium hover:underline ml-1 cursor-pointer"
              @click="mode = 'signup'; formError = null"
            >
              Sign up
            </button>
          </span>
          <span v-else>
            Already have an account?
            <button
              type="button"
              class="text-primary font-medium hover:underline ml-1 cursor-pointer"
              @click="mode = 'signin'; formError = null"
            >
              Sign in
            </button>
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>
