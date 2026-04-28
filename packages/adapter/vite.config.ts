import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        reactive: resolve(__dirname, 'src/reactive.ts'),
        signals: resolve(__dirname, 'src/signals.ts'),
        sync: resolve(__dirname, 'src/sync.ts'),
        container: resolve(__dirname, 'src/container.ts')
      },
      name: 'GaesupStateAdapter',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['gaesup-state']
    },
    sourcemap: true,
    target: 'es2020'
  }
})
