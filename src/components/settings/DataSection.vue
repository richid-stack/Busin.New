<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import { useAccount } from '../../composables/useAccount'
import { useChats } from '../../composables/useChats'
import { useCsrf } from '../../composables/useCsrf'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useMemory } from '../../composables/useMemory'
import { useUserSession } from '../../composables/useUserSession'
import ModalConfirm from './ModalConfirm.vue'
import SettingRow from './SettingRow.vue'

const ModalDeleteAccount = defineAsyncComponent(() => import('./ModalDeleteAccount.vue'))

const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { downloadExport } = useAccount()
const { fetchChats } = useChats()
const { clearAll: clearMemory } = useMemory()
const { signOutUser } = useFirebaseAuth()
const { clearSession } = useUserSession()
const { csrf, headerName } = useCsrf()

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback
const failToast = (title: string, err: any) => toast.add({ title, description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })

const exporting = ref(false)
async function exportData() {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadExport()
    toast.add({ title: 'Your data is downloading', icon: 'i-lucide-download', color: 'success' })
  } catch (err) {
    failToast('Could not export your data', err)
  } finally {
    exporting.value = false
  }
}

const confirm = overlay.create(ModalConfirm)

const clearing = ref(false)
async function clearMemoryNow() {
  const ok = await confirm.open({ title: 'Clear your memory?', description: 'OpenLobs forgets everything it remembered about you. Chats are not touched. This cannot be undone.', confirmLabel: 'Clear memory', icon: 'i-lucide-brain' }).result
  if (!ok) return
  clearing.value = true
  try {
    await clearMemory()
    toast.add({ title: 'Memory cleared', icon: 'i-lucide-check', color: 'success' })
  } catch (err) {
    failToast('Could not clear your memory', err)
  } finally {
    clearing.value = false
  }
}

const deletingChats = ref(false)
async function deleteAllChats() {
  const ok = await confirm.open({ title: 'Delete all your chats?', description: 'Every chat is removed for good, including those inside workspaces. Workspaces, agents, workflows and memory stay. This cannot be undone.', confirmLabel: 'Delete all chats' }).result
  if (!ok) return
  deletingChats.value = true
  try {
    const { deleted } = await $fetch<{ deleted: number }>('/api/chats', { method: 'DELETE', headers: { [headerName]: csrf() } })
    await fetchChats()
    toast.add({ title: deleted === 1 ? '1 chat deleted' : `${deleted} chats deleted`, icon: 'i-lucide-check', color: 'success' })
  } catch (err) {
    failToast('Could not delete your chats', err)
  } finally {
    deletingChats.value = false
  }
}

const deleteModal = overlay.create(ModalDeleteAccount)
async function deleteAccount() {
  const deleted = await deleteModal.open().result
  if (!deleted) return
  // The account no longer exists, so signing out only clears this browser.
  await signOutUser().catch(() => {})
  await clearSession()
  toast.add({ title: 'Your account was deleted', description: 'Everything was removed. Thanks for trying OpenLobs.', icon: 'i-lucide-check', color: 'neutral', duration: 10000 })
  router.push('/')
}
</script>

<template>
  <div class="mt-4 divide-y divide-default border-y border-default">
    <SettingRow title="Download your data" hint="Chats, workflows, agents, memory and more, as one file. Passwords and tokens are never included.">
      <UButton label="Download" icon="i-lucide-download" color="neutral" variant="subtle" size="sm" :loading="exporting" @click="exportData" />
    </SettingRow>
    <SettingRow title="Clear memory" hint="Forget everything OpenLobs remembered about you.">
      <UButton label="Clear" color="neutral" variant="subtle" size="sm" :loading="clearing" @click="clearMemoryNow" />
    </SettingRow>
    <SettingRow title="Delete all chats" hint="Every chat, for good. Workspaces, agents and workflows stay.">
      <UButton label="Delete chats" color="error" variant="subtle" size="sm" :loading="deletingChats" @click="deleteAllChats" />
    </SettingRow>
    <SettingRow title="Delete account" hint="Removes your account and everything in it, for good." danger>
      <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="subtle" size="sm" @click="deleteAccount" />
    </SettingRow>
  </div>
</template>
