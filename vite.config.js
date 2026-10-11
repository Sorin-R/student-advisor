import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import automaticContentPlugin from './scripts/automatic-content-plugin.mjs'

export default defineConfig({
  plugins: [react({ babel: { plugins: [automaticContentPlugin] } })],
  resolve: {
    alias: { '@site-editor/automatic': fileURLToPath(new URL('./src/AutomaticContent.jsx', import.meta.url)) },
  },
  server: {
    allowedHosts: ['sorins-mac-mini.taild4cc7a.ts.net'],
    watch: {
      ignored: ['**/.node_modules-cloud-backup-*/**'],
    },
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
