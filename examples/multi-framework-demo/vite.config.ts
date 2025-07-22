import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react({
      // React Fast Refresh 활성화
      fastRefresh: true,
      // JSX runtime 자동 처리
      jsxRuntime: 'automatic'
    }),
    vue({
      // Vue 3 Composition API 지원
      reactivityTransform: true,
      script: {
        defineModel: true,
        propsDestructure: true
      }
    }),
    svelte({
      // Svelte 컴파일러 옵션
      compilerOptions: {
        dev: process.env.NODE_ENV === 'development'
      },
      // Hot Module Replacement
      hot: process.env.NODE_ENV === 'development'
    })
  ],

  // 개발 서버 설정
  server: {
    port: 3000,
    host: true,
    cors: true,
    // WASM과 SharedArrayBuffer를 위한 헤더
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
    // 프록시 설정 (레지스트리 서버와 연결)
    proxy: {
      '/api/registry': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/registry/, '')
      }
    }
  },

  // 빌드 설정
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      // 다중 진입점 설정
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        // 청크 분할 최적화
        manualChunks: {
          // 프레임워크별 청크 분리
          'react-vendor': ['react', 'react-dom'],
          'vue-vendor': ['vue'],
          'svelte-vendor': ['svelte'],
          'angular-vendor': ['@angular/core', '@angular/platform-browser'],
          // Gaesup-State 코어
          'gaesup-core': [
            '@gaesup-state/core',
            '@gaesup-state/adapter'
          ],
          // 프레임워크 통합
          'gaesup-frameworks': [
            '@gaesup-state/react',
            '@gaesup-state/vue', 
            '@gaesup-state/svelte',
            '@gaesup-state/angular'
          ]
        }
      }
    },
    // WASM 파일 처리
    assetsInlineLimit: 0, // WASM 파일은 인라인하지 않음
    copyPublicDir: true
  },

  // 해상도 설정
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@utils': resolve(__dirname, 'src/utils'),
      // 워크스페이스 패키지 별칭
      '@gaesup-state/core': resolve(__dirname, '../../packages/core/src'),
      '@gaesup-state/adapter': resolve(__dirname, '../../packages/adapter/src'),
      '@gaesup-state/react': resolve(__dirname, '../../packages/frameworks/react/src'),
      '@gaesup-state/vue': resolve(__dirname, '../../packages/frameworks/vue/src'),
      '@gaesup-state/svelte': resolve(__dirname, '../../packages/frameworks/svelte/src'),
      '@gaesup-state/angular': resolve(__dirname, '../../packages/frameworks/angular/src')
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.json']
  },

  // 최적화 설정
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'vue',
      'svelte',
      '@angular/core',
      '@angular/platform-browser',
      '@angular/common'
    ],
    exclude: [
      // WASM 관련 파일은 pre-bundling에서 제외
      '*.wasm'
    ]
  },

  // TypeScript 설정
  esbuild: {
    target: 'esnext',
    keepNames: true,
    // JSX 설정
    jsxFactory: 'h',
    jsxFragment: 'Fragment'
  },

  // 실험적 기능
  experimental: {
    // buildAdvancedBaseOptions: true
  },

  // 환경 변수 설정
  define: {
    __DEV__: process.env.NODE_ENV === 'development',
    __PROD__: process.env.NODE_ENV === 'production',
    __VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    // WASM 지원 확인
    __WASM_SUPPORTED__: 'typeof WebAssembly !== "undefined"'
  },

  // CSS 설정
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/variables.scss";`
      }
    }
  },

  // 워커 설정 (WASM 워커 지원)
  worker: {
    format: 'es',
    plugins: []
  },

  // 보안 설정
  preview: {
    port: 4173,
    cors: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
}); 