import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'
import vue from '@vitejs/plugin-vue'
import vueRouter from 'vue-router/vite'
import vueLayouts from 'vite-plugin-vue-layouts'
import ui from '@nuxt/ui/vite'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  plugins: [
    vueRouter({
      dts: 'src/route-map.d.ts'
    }),
    vueLayouts(),
    vue(),
    ui({
      prose: true,
      ui: {
        colors: {
          primary: 'blue',
          neutral: 'zinc'
        }
      }
    }),
    nitro({
      serverDir: './server',
      // Firebase's server libraries read their own files at runtime (protobuf definitions, via
      // __dirname), which breaks when they are folded into the bundle. Keep them as real packages.
      traceDeps: ['firebase-admin', '@google-cloud/firestore']
    })
  ]
})
