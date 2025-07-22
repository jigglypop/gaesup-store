import type { ContainerConfig } from '../types'

export abstract class WASMRuntime {
  protected readonly config: ContainerConfig

  constructor(config: ContainerConfig) {
    this.config = config
  }

  abstract isAvailable(): boolean
  abstract async instantiate(module: WebAssembly.Module): Promise<WebAssembly.Instance>
  
  // 런타임별 최적화 힌트
  getOptimizationHints(): OptimizationHints {
    return {
      preferredMemoryAlignment: 16,
      supportsBulkMemory: false,
      supportsMultiMemory: false,
      supportsThreads: false,
      preferredStackSize: 1024 * 1024, // 1MB
      maxFunctionParams: 1000
    }
  }

  // 메모리 관리
  protected createMemoryImport(): WebAssembly.MemoryDescriptor {
    const maxMemory = this.config.maxMemory || 100 * 1024 * 1024 // 100MB 기본값
    const initialPages = Math.ceil(maxMemory / (64 * 1024)) // 64KB per page
    const maximumPages = Math.ceil(maxMemory / (64 * 1024))

    return {
      initial: Math.min(initialPages, 1), // 최소 1페이지로 시작
      maximum: maximumPages,
      shared: false
    }
  }

  // 기본 import 객체 생성
  protected createBaseImports(): WebAssembly.Imports {
    const memory = new WebAssembly.Memory(this.createMemoryImport())
    
    return {
      env: {
        memory,
        abort: this.createAbortFunction(),
        trace: this.createTraceFunction(),
        ...this.createMathImports(),
        ...this.createMemoryImports(memory)
      },
      wasi_snapshot_preview1: this.createWASIImports()
    }
  }

  private createAbortFunction() {
    return (message: number, fileName: number, lineNumber: number, columnNumber: number) => {
      throw new Error(`WASM abort: message=${message}, file=${fileName}, line=${lineNumber}, col=${columnNumber}`)
    }
  }

  private createTraceFunction() {
    return (message: number) => {
      if (this.config.environment?.DEBUG === 'true') {
        console.log(`[WASM Trace] ${message}`)
      }
    }
  }

  private createMathImports() {
    return {
      'Math.random': Math.random,
      'Math.sin': Math.sin,
      'Math.cos': Math.cos,
      'Math.tan': Math.tan,
      'Math.sqrt': Math.sqrt,
      'Math.floor': Math.floor,
      'Math.ceil': Math.ceil,
      'Math.round': Math.round,
      'Math.abs': Math.abs,
      'Math.pow': Math.pow,
      'Math.log': Math.log,
      'Math.exp': Math.exp
    }
  }

  private createMemoryImports(memory: WebAssembly.Memory) {
    return {
      'memory.grow': (pages: number) => {
        try {
          return memory.grow(pages)
        } catch (error) {
          return -1 // 실패 시 -1 반환
        }
      },
      'memory.size': () => {
        return memory.buffer.byteLength / (64 * 1024) // 페이지 수 반환
      }
    }
  }

  private createWASIImports() {
    // 기본적인 WASI 구현 (제한적)
    return {
      proc_exit: (code: number) => {
        throw new Error(`WASM process exit with code: ${code}`)
      },
      fd_write: (fd: number, iovs: number, iovs_len: number, nwritten: number) => {
        // stdout/stderr 기본 구현
        if (fd === 1 || fd === 2) {
          // 실제 구현에서는 메모리에서 데이터를 읽어야 함
          return 0 // 성공
        }
        return -1 // 실패
      },
      fd_read: () => -1, // 읽기 비활성화
      fd_seek: () => -1, // 시크 비활성화
      fd_close: () => 0, // 닫기 성공
      environ_sizes_get: () => 0,
      environ_get: () => 0,
      args_sizes_get: () => 0,
      args_get: () => 0,
      random_get: (buf: number, buf_len: number) => {
        // 랜덤 데이터 생성 (실제로는 메모리에 써야 함)
        return 0
      },
      clock_time_get: (id: number, precision: number, time: number) => {
        // 현재 시간 반환 (실제로는 메모리에 써야 함)
        return 0
      }
    }
  }

  // 보안 검증
  protected validateModule(module: WebAssembly.Module): void {
    // 허용된 import만 있는지 확인
    const imports = WebAssembly.Module.imports(module)
    const allowedImports = this.config.allowedImports

    if (allowedImports) {
      for (const importItem of imports) {
        const importName = `${importItem.module}.${importItem.name}`
        if (!allowedImports.includes(importName)) {
          throw new Error(`Unauthorized import: ${importName}`)
        }
      }
    }

    // export 검증
    const exports = WebAssembly.Module.exports(module)
    const requiredExports = ['memory']
    
    for (const required of requiredExports) {
      if (!exports.some(exp => exp.name === required)) {
        console.warn(`Missing recommended export: ${required}`)
      }
    }
  }

  // 성능 힌트
  protected getPerformanceHints(): PerformanceHints {
    return {
      enableOptimizations: true,
      useCompilerOptimizations: true,
      enableInlining: true,
      preferredCompilationTier: 'optimized'
    }
  }
}

export interface OptimizationHints {
  preferredMemoryAlignment: number
  supportsBulkMemory: boolean
  supportsMultiMemory: boolean
  supportsThreads: boolean
  preferredStackSize: number
  maxFunctionParams: number
}

export interface PerformanceHints {
  enableOptimizations: boolean
  useCompilerOptimizations: boolean
  enableInlining: boolean
  preferredCompilationTier: 'baseline' | 'optimized'
} 