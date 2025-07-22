import type { ContainerConfig, ValidationResult } from '@gaesup-state/core'

export function createContainer(
  name: string, 
  wasmModule: WebAssembly.Module, 
  config?: ContainerConfig
) {
  // 실제 구현에서는 ContainerManager를 사용
  return {
    name,
    module: wasmModule,
    config: config || {}
  }
}

export function validateContainer(config: ContainerConfig): ValidationResult {
  const errors: any[] = []
  const warnings: any[] = []

  // 메모리 제한 검증
  if (config.maxMemory && config.maxMemory < 1024 * 1024) {
    warnings.push({
      code: 'LOW_MEMORY',
      message: 'Memory limit is very low (< 1MB)',
      location: 'maxMemory'
    })
  }

  if (config.maxMemory && config.maxMemory > 2 * 1024 * 1024 * 1024) {
    errors.push({
      code: 'EXCESSIVE_MEMORY',
      message: 'Memory limit exceeds 2GB',
      location: 'maxMemory'
    })
  }

  // CPU 시간 제한 검증
  if (config.maxCpuTime && config.maxCpuTime < 100) {
    warnings.push({
      code: 'LOW_CPU_TIME',
      message: 'CPU time limit is very low (< 100ms)',
      location: 'maxCpuTime'
    })
  }

  // 네트워크 접근과 파일 시스템 접근이 모두 허용된 경우
  if (config.networkAccess && config.isolation?.fileSystemAccess) {
    warnings.push({
      code: 'SECURITY_RISK',
      message: 'Both network and file system access are enabled',
      location: 'security'
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
} 