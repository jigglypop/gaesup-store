// React 프레임워크 전용 유틸리티
// Core의 기능을 재사용하고 React 특화 기능만 추가

import { createContainer as coreCreateContainer, validateContainer as coreValidateContainer } from '@gaesup-state/core'
import type { ContainerConfig, ValidationResult } from '@gaesup-state/core'

/**
 * React용 컨테이너 생성 헬퍼 (Core 함수 재사용)
 * @param name 컨테이너 이름
 * @param wasmBytes WASM 바이트 배열
 * @param config 컨테이너 설정
 */
export function createContainer(
  name: string,
  wasmBytes: ArrayBuffer,
  config?: ContainerConfig
) {
  return coreCreateContainer(name, wasmBytes, config)
}

/**
 * 컨테이너 설정 검증 (Core 함수 재사용)
 * @param config 검증할 설정
 */
export function validateContainer(config: ContainerConfig): ValidationResult {
  return coreValidateContainer(config)
}

/**
 * React 전용: WebAssembly.Module을 컨테이너 객체로 래핑
 * @param name 컨테이너 이름
 * @param wasmModule 컴파일된 WASM 모듈
 * @param config 컨테이너 설정
 */
export function wrapWebAssemblyModule(
  name: string,
  wasmModule: WebAssembly.Module,
  config?: ContainerConfig
) {
  return {
    name,
    module: wasmModule,
    config: config || {},
    metadata: {
      name,
      version: 'latest',
      size: 0, // Module에서는 크기를 직접 알 수 없음
      hash: 'module-' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }
}

/**
 * React 전용: 컨테이너 상태를 React state 형태로 변환
 * @param containerState 컨테이너 상태
 */
export function formatContainerStateForReact(containerState: any) {
  if (!containerState) return null
  
  return {
    data: containerState,
    loading: false,
    error: null,
    timestamp: new Date().toISOString()
  }
}

/**
 * React 전용: 에러를 React Error Boundary용 형태로 변환
 * @param error 원본 에러
 */
export function formatContainerError(error: any) {
  return {
    name: 'ContainerError',
    message: error?.message || 'Unknown container error',
    stack: error?.stack,
    containerInfo: error?.containerInfo || null,
    timestamp: new Date().toISOString()
  }
} 