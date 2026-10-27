<script setup lang="ts">
import { ref, watch } from 'vue'
import { REPORT_REASONS } from '../../types/reef'

const props = defineProps<{ title: string, send: (reason: string, note: string) => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const toast = useToast()

const reason = ref('spam')
const note = ref('')
const sending = ref(false)
watch(open, (o) => { if (o) { reason.value = 'spam'; note.value = '' } })

async function submit() {
  sending.value = true
  try {
    await props.send(reason.value, note.value.trim())
    open.value = false
    toast.add({ title: 'Thank you. We will look at it.', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not send the report', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="title" description="Several reports from different people hide it until someone has looked.">
    <template #body>
      <URadioGroup v-model="reason" :items="REPORT_REASONS" value-key="value" label-key="label" />
      <UTextarea v-model="note" class="w-full mt-4" :rows="3" maxlength="300" placeholder="Anything else we should know? (optional)" />
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Send report" color="neutral" :loading="sending" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
