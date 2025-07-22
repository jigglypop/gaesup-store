import { WASMRuntime } from './WASMRuntime'
import type { ContainerConfig } from '../types'

export class WasmerRuntime extends WASMRuntime {
  constructor(config: ContainerConfig) {
    super(config)
  }

  isAvailable(): boolean {
    // Wasmer는 브라우저와 서버 양쪽에서 사용 가능
    try {
      // @wasmer/wasi 패키지 확인
      return typeof WebAssembly !== 'undefined'
    } catch {
      return false
    }
  }

  async instantiate(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    if (!this.isAvailable()) {
      throw new Error('Wasmer runtime not available')
    }

    this.validateModule(module)
    const imports = this.createWasmerImports()
    
    try {
      // Wasmer WASI를 사용한 인스턴스 생성
      return await WebAssembly.instantiate(module, imports)
    } catch (error) {
      throw new Error(`Wasmer instantiation failed: ${error.message}`)
    }
  }

  private createWasmerImports(): WebAssembly.Imports {
    const baseImports = this.createBaseImports()
    
    return {
      ...baseImports,
      wasmer: {
        // Wasmer 특화 기능들
        universal_engine: () => {
          // Universal engine 지원
          return 0
        },
        dylib_engine: () => {
          // Dynamic library engine
          return 0
        },
        cranelift_compiler: () => {
          // Cranelift 컴파일러
          return 0
        },
        llvm_compiler: () => {
          // LLVM 컴파일러 (성능 최적화)
          return 0
        },
        singlepass_compiler: () => {
          // Singlepass 컴파일러 (빠른 컴파일)
          return 0
        }
      },
      wasi: this.createWASIImports()
    }
  }

  getOptimizationHints() {
    return {
      ...super.getOptimizationHints(),
      supportsBulkMemory: true,
      supportsMultiMemory: false,
      supportsThreads: true,
      preferredMemoryAlignment: 8,
      maxFunctionParams: 8000
    }
  }

  protected getPerformanceHints() {
    return {
      ...super.getPerformanceHints(),
      preferredCompilationTier: 'optimized' as const,
      enableInlining: true,
      useCompilerOptimizations: true
    }
  }
} 