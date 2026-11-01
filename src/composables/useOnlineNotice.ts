import { watch } from 'vue'
import { useOnline } from '@vueuse/core'

/**
 * Tells the person when the connection drops and when it is back. Connections come and go, and without a word
 * about it every failed button looks like a bug. Quiet when all is well; one toast each way, no repeats.
 */
export function useOnlineNotice() {
  const online = useOnline()
  const toast = useToast()
  watch(online, (now, before) => {
    if (now === before) return
    if (!now) {
      toast.add({ id: 'offline', title: 'You are offline', description: 'OpenLobs will pick up again when your connection is back.', icon: 'i-lucide-wifi-off', color: 'warning', duration: 0 })
    } else {
      toast.remove('offline')
      toast.add({ id: 'online', title: 'Back online', icon: 'i-lucide-wifi', color: 'success', duration: 2500 })
    }
  })
  return { online }
}
