import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GaesupStateSvelte',
      fileName: (format) => (format === 'es' ? 'index.esm.js' : 'index.js'),
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['gaesup-state', '@gaesup-state/adapter', 'svelte', 'svelte/store']
    },
    sourcemap: true,
    target: 'es2020'
  }
})
