<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useBilling } from '../../composables/useBilling'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Confirming payment · OpenLobs' })

const route = useRoute()
const router = useRouter()
const { verifyPayment } = useBilling()
const { authReady } = useFirebaseAuth()

type State = 'working' | 'success' | 'pending' | 'failed' | 'error'
const state = ref<State>('working')
const message = ref('')
const endsAt = ref('')

const reference = String(route.query.reference || route.query.trxref || '')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

async function check(attempt = 0) {
  if (!reference) { state.value = 'error'; message.value = 'This page needs a payment reference. Open Settings to see your plan.'; return }
  state.value = 'working'
  try {
    const res = await verifyPayment(reference)
    if (res.status === 'applied' || res.status === 'already') {
      endsAt.value = res.endsAt
      state.value = 'success'
    } else if (res.status === 'failed') {
      state.value = 'failed'
    } else if (attempt < 4) {
      // Mobile money can take a moment after the phone approval.
      setTimeout(() => check(attempt + 1), 3000)
    } else {
      state.value = 'pending'
    }
  } catch (err: any) {
    state.value = 'error'
    message.value = err?.data?.statusMessage || err?.statusMessage || 'Could not check the payment. Open Settings in a minute to see if it went through.'
  }
}

// The sign-in is restored a moment after the page opens; the check needs it.
onMounted(() => {
  if (authReady.value) check()
  else {
    const stop = setInterval(() => { if (authReady.value) { clearInterval(stop); check() } }, 200)
    setTimeout(() => clearInterval(stop), 10_000)
  }
})

const ICON: Record<State, string> = { working: 'i-lucide-loader-2', success: 'i-lucide-circle-check', pending: 'i-lucide-clock', failed: 'i-lucide-circle-x', error: 'i-lucide-triangle-alert' }
</script>

<template>
  <div class="min-h-[100dvh] flex items-center justify-center px-6 bg-default">
    <div class="w-full max-w-sm text-center" role="status" aria-live="polite">
      <div class="mx-auto mb-6 size-14 rounded-2xl border border-default bg-elevated/50 shadow-sm flex items-center justify-center">
        <UIcon :name="ICON[state]" class="size-7" :class="[state === 'working' ? 'animate-spin text-muted' : state === 'success' ? 'text-success' : state === 'failed' || state === 'error' ? 'text-error' : 'text-warning']" />
      </div>
      <template v-if="state === 'working'">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">Confirming your payment</h1>
        <p class="text-sm text-muted">This takes a few seconds. If you paid with mobile money, approve it on your phone first.</p>
      </template>
      <template v-else-if="state === 'success'">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">You are on Pro</h1>
        <p class="text-sm text-muted mb-6">Thank you. Pro runs until {{ day(endsAt) }}. A receipt is on its way to your email.</p>
        <UButton label="Go to Settings" color="neutral" icon="i-lucide-settings" @click="router.push('/settings')" />
      </template>
      <template v-else-if="state === 'pending'">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">Still confirming</h1>
        <p class="text-sm text-muted mb-6">Your payment has not been confirmed yet. If money left your account, Pro turns on by itself within a few minutes. You can check again below.</p>
        <div class="flex justify-center gap-2">
          <UButton label="Check again" color="neutral" icon="i-lucide-refresh-cw" @click="check()" />
          <UButton label="Settings" color="neutral" variant="ghost" @click="router.push('/settings')" />
        </div>
      </template>
      <template v-else-if="state === 'failed'">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">The payment did not go through</h1>
        <p class="text-sm text-muted mb-6">You were not charged for this attempt. You can try again from Settings.</p>
        <UButton label="Back to Settings" color="neutral" @click="router.push('/settings')" />
      </template>
      <template v-else>
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">We could not check it</h1>
        <p class="text-sm text-muted mb-6">{{ message }}</p>
        <UButton label="Back to Settings" color="neutral" @click="router.push('/settings')" />
      </template>
    </div>
  </div>
</template>
