import type { WASMRuntimeType, ContainerConfig } from '../types'
import { WASMRuntime } from './WASMRuntime'
import { BrowserRuntime } from './BrowserRuntime'
import { NodejsRuntime } from './NodejsRuntime'
import { WasmtimeRuntime } from './WasmtimeRuntime'
import { WasmedgeRuntime } from './WasmedgeRuntime'
import { WasmerRuntime } from './WasmerRuntime'

export class RuntimeFactory {
  private readonly runtimes: Map<WASMRuntimeType, typeof WASMRuntime> = new Map()

  constructor() {
    this.registerRuntimes()
  }

  create(type: WASMRuntimeType, config: ContainerConfig): WASMRuntime {
    const RuntimeClass = this.runtimes.get(type)
    
    if (!RuntimeClass) {
      throw new Error(`Unsupported runtime type: ${type}`)
    }

    return new RuntimeClass(config)
  }

  getSupportedRuntimes(): WASMRuntimeType[] {
    return Array.from(this.runtimes.keys())
  }

  isRuntimeAvailable(type: WASMRuntimeType): boolean {
    try {
      const runtime = this.create(type, {})
      return runtime.isAvailable()
    } catch {
      return false
    }
  }

  getBestAvailableRuntime(): WASMRuntimeType {
    // 우선순위: browser > nodejs > wasmtime > wasmedge > wasmer
    const preferredOrder: WASMRuntimeType[] = [
      'browser',
      'nodejs', 
      'wasmtime',
      'wasmedge',
      'wasmer'
    ]

    for (const runtime of preferredOrder) {
      if (this.isRuntimeAvailable(runtime)) {
        return runtime
      }
    }

    throw new Error('No WASM runtime available')
  }

  private registerRuntimes(): void {
    this.runtimes.set('browser', BrowserRuntime)
    this.runtimes.set('nodejs', NodejsRuntime)
    this.runtimes.set('wasmtime', WasmtimeRuntime)
    this.runtimes.set('wasmedge', WasmedgeRuntime)
    this.runtimes.set('wasmer', WasmerRuntime)
  }

  // 런타임 기능 매트릭스
  getRuntimeCapabilities(type: WASMRuntimeType): RuntimeCapabilities {
    const baseCapabilities: RuntimeCapabilities = {
      memoryIsolation: true,
      fileSystemAccess: false,
      networkAccess: false,
      threadSupport: false,
      simdSupport: false,
      debugSupport: false
    }

    switch (type) {
      case 'browser':
        return {
          ...baseCapabilities,
          simdSupport: true,
          debugSupport: true
        }

      case 'nodejs':
        return {
          ...baseCapabilities,
          threadSupport: true,
          simdSupport: true,
          debugSupport: true
        }

      case 'wasmtime':
        return {
          ...baseCapabilities,
          fileSystemAccess: true,
          networkAccess: true,
          threadSupport: true,
          simdSupport: true,
          debugSupport: true
        }

      case 'wasmedge':
        return {
          ...baseCapabilities,
          fileSystemAccess: true,
          networkAccess: true,
          threadSupport: true,
          simdSupport: true
        }

      case 'wasmer':
        return {
          ...baseCapabilities,
          fileSystemAccess: true,
          networkAccess: true,
          threadSupport: true,
          simdSupport: true
        }

      default:
        return baseCapabilities
    }
  }
}

export interface RuntimeCapabilities {
  memoryIsolation: boolean
  fileSystemAccess: boolean
  networkAccess: boolean
  threadSupport: boolean
  simdSupport: boolean
  debugSupport: boolean
} 