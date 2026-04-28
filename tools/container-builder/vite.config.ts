import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GaesupContainerBuilder',
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['fs/promises', 'path', 'crypto', 'tar']
    },
    sourcemap: true,
    target: 'es2020'
  }
})
