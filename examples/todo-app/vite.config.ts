import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@gaesup-state/core': resolve(__dirname, '../../packages/core/src'),
      '@gaesup-state/react': resolve(__dirname, '../../packages/frameworks/react/src')
    }
  },

  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development')
  },

  server: {
    port: 3000,
    host: true,
    headers: {
      // WASM을 위한 Cross-Origin 헤더
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },

  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          gaesup: ['@gaesup-state/core', '@gaesup-state/react']
        }
      }
    }
  },

  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@gaesup-state/core', '@gaesup-state/react']
  },

  // WASM 지원
  assetsInclude: ['**/*.wasm']
}) 