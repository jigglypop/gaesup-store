import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/builder/ContainerBuilder.ts'),
      name: 'GaesupContainerBuilder',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['fs/promises', 'path', 'crypto', 'tar']
    },
    sourcemap: true,
    target: 'es2020'
  }
})
