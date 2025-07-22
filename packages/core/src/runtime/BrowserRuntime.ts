import { WASMRuntime } from './WASMRuntime'
import type { ContainerConfig } from '../types'

export class BrowserRuntime extends WASMRuntime {
  constructor(config: ContainerConfig) {
    super(config)
  }

  isAvailable(): boolean {
    return typeof WebAssembly !== 'undefined' && 
           typeof WebAssembly.instantiate === 'function' &&
           typeof window !== 'undefined'
  }

  async instantiate(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    if (!this.isAvailable()) {
      throw new Error('Browser WASM runtime not available')
    }

    this.validateModule(module)

    const imports = this.createBrowserImports()
    
    try {
      const instance = await WebAssembly.instantiate(module, imports)
      this.setupBrowserOptimizations(instance)
      return instance
    } catch (error) {
      throw new Error(`Failed to instantiate WASM module in browser: ${error.message}`)
    }
  }

  private createBrowserImports(): WebAssembly.Imports {
    const baseImports = this.createBaseImports()
    
    return {
      ...baseImports,
      browser: {
        console_log: (ptr: number, len: number) => {
          // 메모리에서 문자열 읽기 (실제 구현 필요)
          console.log('[WASM]', `String at ${ptr}, length ${len}`)
        },
        performance_now: () => performance.now(),
        request_animation_frame: (callback: number) => {
          // 콜백 예약 (실제로는 더 복잡한 구현 필요)
          return requestAnimationFrame(() => {
            // WASM 콜백 호출
          })
        },
        cancel_animation_frame: (id: number) => {
          cancelAnimationFrame(id)
        },
        set_timeout: (callback: number, delay: number) => {
          return setTimeout(() => {
            // WASM 콜백 호출
          }, delay)
        },
        clear_timeout: (id: number) => {
          clearTimeout(id)
        },
        get_element_by_id: (ptr: number, len: number) => {
          // DOM 요소 접근 (제한적)
          // 실제로는 메모리에서 ID 문자열을 읽어야 함
          return 0 // 요소 핸들 반환
        }
      },
      webgl: this.createWebGLImports(),
      storage: this.createStorageImports()
    }
  }

  private createWebGLImports() {
    // WebGL API 바인딩 (기본적인 것들만)
    return {
      create_context: () => {
        // WebGL 컨텍스트 생성
        return 0 // 컨텍스트 ID
      },
      clear_color: (r: number, g: number, b: number, a: number) => {
        // WebGL 클리어 색상 설정
      },
      clear: (mask: number) => {
        // WebGL 클리어
      },
      draw_arrays: (mode: number, first: number, count: number) => {
        // WebGL 그리기
      }
    }
  }

  private createStorageImports() {
    return {
      local_storage_get: (keyPtr: number, keyLen: number, valuePtr: number, maxLen: number) => {
        try {
          // 로컬 스토리지에서 값 읽기 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      },
      local_storage_set: (keyPtr: number, keyLen: number, valuePtr: number, valueLen: number) => {
        try {
          // 로컬 스토리지에 값 저장 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      },
      local_storage_remove: (keyPtr: number, keyLen: number) => {
        try {
          // 로컬 스토리지에서 값 제거 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      }
    }
  }

  private setupBrowserOptimizations(instance: WebAssembly.Instance): void {
    // 브라우저 특화 최적화
    
    // 1. 메모리 사전 할당
    const memory = instance.exports.memory as WebAssembly.Memory
    if (memory && this.config.maxMemory) {
      try {
        const targetPages = Math.ceil(this.config.maxMemory / (64 * 1024))
        const currentPages = memory.buffer.byteLength / (64 * 1024)
        const pagesToGrow = targetPages - currentPages
        
        if (pagesToGrow > 0) {
          memory.grow(Math.min(pagesToGrow, 10)) // 최대 10페이지씩 증가
        }
      } catch (error) {
        console.warn('[BrowserRuntime] Memory pre-allocation failed:', error)
      }
    }

    // 2. JIT 워밍업
    this.warmupJIT(instance)
  }

  private warmupJIT(instance: WebAssembly.Instance): void {
    // 주요 함수들을 한 번씩 실행하여 JIT 최적화 유도
    const exports = instance.exports
    const warmupFunctions = ['_start', 'main', 'init']
    
    for (const funcName of warmupFunctions) {
      const func = exports[funcName] as Function
      if (typeof func === 'function') {
        try {
          // 안전한 더미 호출 (실제 함수에 따라 조정 필요)
          // func() // 주의: 부작용이 있을 수 있음
        } catch (error) {
          // 워밍업 실패는 무시
        }
      }
    }
  }

  getOptimizationHints() {
    return {
      ...super.getOptimizationHints(),
      supportsBulkMemory: this.checkBulkMemorySupport(),
      supportsMultiMemory: false, // 브라우저는 아직 미지원
      supportsThreads: this.checkThreadSupport(),
      preferredMemoryAlignment: 8 // 브라우저 최적화
    }
  }

  private checkBulkMemorySupport(): boolean {
    try {
      // Bulk memory operations 지원 확인
      return typeof WebAssembly.Memory.prototype.fill === 'function'
    } catch {
      return false
    }
  }

  private checkThreadSupport(): boolean {
    try {
      // SharedArrayBuffer와 Atomics 지원 확인
      return typeof SharedArrayBuffer !== 'undefined' && 
             typeof Atomics !== 'undefined'
    } catch {
      return false
    }
  }

  protected getPerformanceHints() {
    return {
      ...super.getPerformanceHints(),
      preferredCompilationTier: 'optimized' as const, // 브라우저는 최적화된 컴파일 선호
      enableInlining: true,
      useCompilerOptimizations: true
    }
  }
} 