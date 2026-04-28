import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GaesupStateAngular',
      fileName: (format) => (format === 'es' ? 'index.esm.js' : 'index.js'),
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['@gaesup-state/core', '@gaesup-state/adapter', '@angular/core', '@angular/common', 'rxjs']
    },
    sourcemap: true,
    target: 'es2020'
  }
})
