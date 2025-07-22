import type { ReactNode, ComponentType } from 'react'
import type {
  ContainerConfig,
  ContainerManagerConfig,
  ContainerInstance,
  ContainerMetrics,
  ContainerEvent,
  ContainerEventType,
  ContainerMetadata,
  ContainerError
} from '@gaesup-state/core'

// useContainerState 훅 타입들
export interface UseContainerStateOptions<T> {
  initialState?: T                    // 초기 상태값
  autoStart?: boolean                // 자동 시작 여부 (기본: true)
  containerConfig?: ContainerConfig   // 컨테이너 설정
  onError?: (error: Error) => void   // 에러 핸들러
  onStateChange?: (state: T) => void // 상태 변경 핸들러
  suspense?: boolean                 // Suspense 모드 활성화
  retryCount?: number                // 재시도 횟수
  retryDelay?: number                // 재시도 지연 시간 (ms)
}

export interface UseContainerStateResult<T> {
  state: T                           // 현재 상태
  isLoading: boolean                 // 로딩 중 여부
  error: Error | null               // 에러 정보
  container: ContainerInstance | null // 컨테이너 인스턴스
  
  // 함수 호출
  call: <R = any>(functionName: string, args?: any) => Promise<R>
  
  // 상태 업데이트
  setState: (state: T | ((prev: T) => T)) => Promise<void>
  
  // 컨테이너 재시작
  restart: () => Promise<void>
  
  // 수동 새로고침
  refresh: () => Promise<void>
}

// useContainerRegistry 훅 타입들
export interface UseContainerRegistryResult {
  search: (query: string) => Promise<ContainerMetadata[]>
  pull: (name: string, version?: string) => Promise<ContainerMetadata>
  push: (container: ContainerData) => Promise<void>
  list: () => Promise<ContainerMetadata[]>
  remove: (name: string, version?: string) => Promise<void>
  prune: () => Promise<void>
  
  isLoading: boolean
  error: Error | null
}

export interface ContainerData {
  name: string
  version: string
  wasmBytes: ArrayBuffer
  metadata: ContainerMetadata
}

// useContainerMetrics 훅 타입들
export interface UseContainerMetricsOptions {
  refreshInterval?: number           // 새로고침 간격 (ms, 기본: 1000)
  enabled?: boolean                  // 메트릭 수집 활성화
}

// Provider 컴포넌트 타입들
export interface ContainerProviderProps {
  config: ContainerManagerConfig
  children: ReactNode
  fallback?: ComponentType<{ error: Error }>
}

export interface ContainerSuspenseProps {
  fallback: ReactNode
  children: ReactNode
  onError?: (error: Error) => void
}

export interface ContainerErrorBoundaryProps {
  children: ReactNode
  fallback?: ComponentType<{ error: Error; reset: () => void }>
  onError?: (error: Error, errorInfo: any) => void
  resetOnPropsChange?: boolean
  resetKeys?: Array<string | number>
}

// Context 타입들
export interface ContainerContextValue {
  manager: ContainerManager | null
  config: ContainerManagerConfig
  isInitialized: boolean
  error: Error | null
}

// 이벤트 관련 타입들
export interface UseContainerEventsOptions {
  eventTypes?: ContainerEventType[]
  bufferSize?: number               // 이벤트 버퍼 크기
}

// 훅 팩토리 타입들
export interface HookFactory<THook, TOptions = any> {
  create: (options?: TOptions) => THook
  destroy: (hook: THook) => void
}

// 성능 관련 타입들
export interface PerformanceMetrics {
  renderCount: number
  lastRenderTime: number
  averageRenderTime: number
  stateUpdateCount: number
  errorCount: number
}

// 디버그 타입들
export interface DebugInfo {
  containerId?: string
  containerName?: string
  hookName: string
  renderCount: number
  lastUpdate: Date
  state: any
} 