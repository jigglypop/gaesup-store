import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GaesupStateCore',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        '@wasmer/wasi',
        '@wasmer/wasmfs'
      ],
      output: {
        globals: {
          '@wasmer/wasi': 'WasmerWasi',
          '@wasmer/wasmfs': 'WasmerWasmfs'
        }
      }
    },
    sourcemap: true,
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
}) 