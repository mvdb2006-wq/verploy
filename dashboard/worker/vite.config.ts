import path from 'node:path'
import { defineConfig } from 'vite'

const root = path.resolve(import.meta.dirname, '..')

// Bundelt de worker (en de gedeelde code uit src/lib) tot één Node-module; npm-pakketten blijven extern.
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      'server-only': path.join(root, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  build: {
    ssr: path.join(root, 'worker/main.ts'),
    outDir: path.join(root, 'worker/dist'),
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'main.mjs', format: 'es' } },
  },
  publicDir: false,
  ssr: { target: 'node' },
})
