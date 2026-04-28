import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/server.ts'),
      name: 'GaesupRegistry',
      fileName: 'server',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        '@fastify/cors',
        '@fastify/helmet',
        '@fastify/multipart',
        '@fastify/rate-limit',
        '@fastify/static',
        'fastify',
        'crypto',
        'fs/promises',
        'path',
        'stream'
      ]
    },
    sourcemap: true,
    target: 'node18'
  }
});
