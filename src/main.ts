import './assets/css/main.css'

import { createApp } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import { routes, handleHotUpdate } from 'vue-router/auto-routes'
import { setupLayouts } from 'virtual:generated-layouts'
import { createHead } from '@unhead/vue/client'
import ui from '@nuxt/ui/vue-plugin'

import App from './App.vue'
import { installAuthFetch } from './lib/authFetch'

installAuthFetch()

const app = createApp(App)

const head = createHead()
const router = createRouter({
  routes: setupLayouts(routes as RouteRecordRaw[]),
  history: createWebHistory()
})

router.onError((error, to) => {
  console.error('Router navigation error:', error)
  const errMsg = error?.message || ''
  if (
    errMsg.includes('Failed to fetch dynamically imported module') ||
    errMsg.includes('Importing a module script failed') ||
    errMsg.includes('error loading dynamically imported module')
  ) {
    const key = `reload_chunk_${to?.path || 'app'}`
    if (typeof window !== 'undefined' && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.assign(to?.fullPath || window.location.href)
    }
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const key = 'vite_preload_reload'
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      event.preventDefault()
      window.location.reload()
    }
  })
}

app.use(head)
app.use(router)
app.use(ui)

app.mount('#app')

// This will update routes at runtime without reloading the page
if (import.meta.hot) {
  handleHotUpdate(router)
}
