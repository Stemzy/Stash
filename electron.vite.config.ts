import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const version = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version

const shared = { '@shared': resolve(__dirname, 'shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { main: resolve(__dirname, 'electron/main.ts'), labWorker: resolve(__dirname, 'electron/services/lab/worker.ts') } } }
  },
  preload: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src') } },
    plugins: [react(), tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } } }
  }
})
