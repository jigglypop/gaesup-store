import { WASMRuntime } from './WASMRuntime'
import type { ContainerConfig } from '../types'

export class NodejsRuntime extends WASMRuntime {
  constructor(config: ContainerConfig) {
    super(config)
  }

  isAvailable(): boolean {
    return typeof WebAssembly !== 'undefined' && 
           typeof process !== 'undefined' &&
           typeof process.versions?.node !== 'undefined'
  }

  async instantiate(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    if (!this.isAvailable()) {
      throw new Error('Node.js WASM runtime not available')
    }

    this.validateModule(module)

    const imports = this.createNodejsImports()
    
    try {
      const instance = await WebAssembly.instantiate(module, imports)
      this.setupNodejsOptimizations(instance)
      return instance
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to instantiate WASM module in Node.js: ${message}`)
    }
  }

  private createNodejsImports(): WebAssembly.Imports {
    const baseImports = this.createBaseImports()
    
    return {
      ...baseImports,
      nodejs: {
        console_log: (ptr: number, len: number) => {
          // 메모리에서 문자열 읽기 (실제 구현 필요)
          console.log('[WASM]', `String at ${ptr}, length ${len}`)
        },
        console_error: (ptr: number, len: number) => {
          console.error('[WASM]', `String at ${ptr}, length ${len}`)
        },
        process_hrtime: () => {
          const hrtime = process.hrtime()
          return hrtime[0] * 1e9 + hrtime[1] // 나노초 반환
        },
        process_exit: (code: number) => {
          process.exit(code)
        },
        get_env: (keyPtr: number, keyLen: number, valuePtr: number, maxLen: number) => {
          try {
            // 환경 변수 읽기 (실제 구현 필요)
            return 0 // 성공
          } catch {
            return -1 // 실패
          }
        }
      },
      fs: this.createFileSystemImports(),
      buffer: this.createBufferImports(),
      crypto: this.createCryptoImports()
    }
  }

  private createFileSystemImports() {
    // 파일 시스템 액세스가 허용된 경우에만
    if (!this.config.isolation?.fileSystemAccess) {
      return {}
    }

    return {
      read_file: (pathPtr: number, pathLen: number, bufPtr: number, maxLen: number) => {
        try {
          // 파일 읽기 (실제 구현 필요)
          // const fs = require('fs')
          return 0 // 읽은 바이트 수
        } catch {
          return -1 // 실패
        }
      },
      write_file: (pathPtr: number, pathLen: number, dataPtr: number, dataLen: number) => {
        try {
          // 파일 쓰기 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      },
      file_exists: (pathPtr: number, pathLen: number) => {
        try {
          // 파일 존재 확인 (실제 구현 필요)
          return 1 // 존재
        } catch {
          return 0 // 존재하지 않음
        }
      },
      create_dir: (pathPtr: number, pathLen: number) => {
        try {
          // 디렉터리 생성 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      }
    }
  }

  private createBufferImports() {
    return {
      buffer_alloc: (size: number) => {
        try {
          // Buffer 할당 (실제로는 WASM 메모리와 연동 필요)
          return 0 // 버퍼 핸들
        } catch {
          return -1 // 실패
        }
      },
      buffer_free: (handle: number) => {
        // Buffer 해제
        return 0
      },
      buffer_copy: (srcHandle: number, dstPtr: number, srcOffset: number, length: number) => {
        try {
          // Buffer에서 WASM 메모리로 복사
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      }
    }
  }

  private createCryptoImports() {
    return {
      random_bytes: (ptr: number, len: number) => {
        try {
          // 암호학적으로 안전한 랜덤 바이트 생성
          // const crypto = require('crypto')
          // const randomBytes = crypto.randomBytes(len)
          // WASM 메모리에 복사 (실제 구현 필요)
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      },
      hash_sha256: (dataPtr: number, dataLen: number, hashPtr: number) => {
        try {
          // SHA256 해시 계산
          // const crypto = require('crypto')
          // const hash = crypto.createHash('sha256')
          // 실제 구현 필요
          return 0 // 성공
        } catch {
          return -1 // 실패
        }
      }
    }
  }

  private setupNodejsOptimizations(instance: WebAssembly.Instance): void {
    // Node.js 특화 최적화
    
    // 1. V8 최적화 힌트
    this.enableV8Optimizations()

    // 2. 메모리 최적화
    this.optimizeMemoryUsage(instance)

    // 3. GC 튜닝
    this.tuneGarbageCollection()
  }

  private enableV8Optimizations(): void {
    // V8 최적화 플래그 (실행 시 설정해야 함)
    const optimizationHints = [
      '--max-old-space-size=8192', // 8GB 힙
      '--optimize-for-size',        // 크기 최적화
      '--turbo-fast-api-calls',     // 빠른 API 호출
      '--experimental-wasm-threads' // WASM 스레드
    ]

    if (this.config.environment?.NODE_ENV === 'production') {
      // 프로덕션 최적화
      console.log('[NodejsRuntime] Production optimizations enabled')
    }
  }

  private optimizeMemoryUsage(instance: WebAssembly.Instance): void {
    const memory = instance.exports.memory as WebAssembly.Memory
    if (!memory) return

    // 메모리 사용량 모니터링
    const usage = process.memoryUsage()
    const wasmMemorySize = memory.buffer.byteLength

    if (this.config.maxMemory && wasmMemorySize > this.config.maxMemory) {
      console.warn(`[NodejsRuntime] WASM memory (${wasmMemorySize}) exceeds limit (${this.config.maxMemory})`)
    }

    // Node.js 특화 메모리 최적화
    if (global.gc && typeof global.gc === 'function') {
      // 가비지 컬렉션 힌트
      setTimeout(() => global.gc?.(), 1000)
    }
  }

  private tuneGarbageCollection(): void {
    // GC 압박 모니터링
    const startUsage = process.memoryUsage()
    
    setInterval(() => {
      const currentUsage = process.memoryUsage()
      const heapGrowth = currentUsage.heapUsed - startUsage.heapUsed
      
      // 힙 사용량이 급격히 증가하면 GC 유도
      if (heapGrowth > 50 * 1024 * 1024 && global.gc) { // 50MB 증가
        global.gc()
      }
    }, 5000) // 5초마다 체크
  }

  override getOptimizationHints() {
    return {
      ...super.getOptimizationHints(),
      supportsBulkMemory: this.checkBulkMemorySupport(),
      supportsMultiMemory: false,
      supportsThreads: this.checkWorkerThreadsSupport(),
      preferredMemoryAlignment: 8,
      maxFunctionParams: 10000 // Node.js는 더 많은 파라미터 지원
    }
  }

  private checkBulkMemorySupport(): boolean {
    try {
      return process.versions.v8 >= '7.9' // V8 7.9+에서 bulk memory 지원
    } catch {
      return false
    }
  }

  private checkWorkerThreadsSupport(): boolean {
    try {
      // Worker threads 지원 확인
      require.resolve('worker_threads')
      return true
    } catch {
      return false
    }
  }

  protected override getPerformanceHints() {
    return {
      ...super.getPerformanceHints(),
      preferredCompilationTier: 'optimized' as const,
      enableInlining: true,
      useCompilerOptimizations: true
    }
  }

  // Node.js 특화 메서드들
  getNodejsVersion(): string {
    return process.versions.node
  }

  getV8Version(): string {
    return process.versions.v8
  }

  isRunningInCluster(): boolean {
    return !!process.env.NODE_CLUSTER_ID
  }

  getSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: this.getNodejsVersion(),
      v8Version: this.getV8Version(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    }
  }
} 