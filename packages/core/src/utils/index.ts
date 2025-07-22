import type { ContainerConfig, ValidationResult, CompileOptions } from '../types'

export function createContainer(
  name: string,
  wasmBytes: ArrayBuffer,
  config?: ContainerConfig
) {
  return {
    name,
    wasmBytes,
    config: config || {},
    metadata: {
      name,
      version: 'latest',
      size: wasmBytes.byteLength,
      hash: generateHash(wasmBytes),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }
}

export function validateContainer(config: ContainerConfig): ValidationResult {
  const errors: any[] = []
  const warnings: any[] = []

  // 메모리 검증
  if (config.maxMemory) {
    if (config.maxMemory < 0) {
      errors.push({
        code: 'INVALID_MEMORY',
        message: 'Memory limit cannot be negative',
        location: 'maxMemory'
      })
    }
    
    if (config.maxMemory < 64 * 1024) {
      warnings.push({
        code: 'LOW_MEMORY',
        message: 'Memory limit is very low (< 64KB)',
        location: 'maxMemory'
      })
    }
  }

  // CPU 시간 검증
  if (config.maxCpuTime) {
    if (config.maxCpuTime < 0) {
      errors.push({
        code: 'INVALID_CPU_TIME',
        message: 'CPU time limit cannot be negative',
        location: 'maxCpuTime'
      })
    }
  }

  // 허용된 imports 검증
  if (config.allowedImports) {
    const invalidImports = config.allowedImports.filter(imp => !isValidImportName(imp))
    if (invalidImports.length > 0) {
      errors.push({
        code: 'INVALID_IMPORTS',
        message: `Invalid import names: ${invalidImports.join(', ')}`,
        location: 'allowedImports'
      })
    }
  }

  // 환경 변수 검증
  if (config.environment) {
    const invalidEnvVars = Object.keys(config.environment).filter(key => !isValidEnvVarName(key))
    if (invalidEnvVars.length > 0) {
      warnings.push({
        code: 'INVALID_ENV_VARS',
        message: `Invalid environment variable names: ${invalidEnvVars.join(', ')}`,
        location: 'environment'
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

export async function compileWASM(
  wasmBytes: ArrayBuffer,
  options?: CompileOptions
): Promise<WebAssembly.Module> {
  try {
    const module = await WebAssembly.compile(wasmBytes)
    
    // 컴파일 후 검증
    const imports = WebAssembly.Module.imports(module)
    const exports = WebAssembly.Module.exports(module)
    
    console.log(`[WASM] Compiled module with ${imports.length} imports and ${exports.length} exports`)
    
    return module
  } catch (error) {
    throw new Error(`WASM compilation failed: ${error.message}`)
  }
}

// 헬퍼 함수들
function generateHash(buffer: ArrayBuffer): string {
  // 간단한 해시 함수 (실제로는 더 강력한 해시 알고리즘 사용)
  let hash = 0
  const view = new Uint8Array(buffer)
  
  for (let i = 0; i < view.length; i++) {
    hash = ((hash << 5) - hash + view[i]) & 0xffffffff
  }
  
  return hash.toString(16)
}

function isValidImportName(name: string): boolean {
  // import 이름 유효성 검사
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(name)
}

function isValidEnvVarName(name: string): boolean {
  // 환경 변수 이름 유효성 검사
  return /^[A-Z_][A-Z0-9_]*$/.test(name)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`
  return `${(ms / 3600000).toFixed(2)}h`
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => inThrottle = false, wait)
    }
  }
} 