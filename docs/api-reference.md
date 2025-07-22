# API 레퍼런스

## Core API

### ContainerManager

WASM 컨테이너의 생명주기를 관리하는 핵심 클래스입니다.

```typescript
class ContainerManager {
  constructor(config?: ContainerManagerConfig)
  
  // 컨테이너 실행
  async run(name: string, config?: ContainerConfig): Promise<ContainerInstance>
  
  // 컨테이너 중지
  async stop(containerId: string): Promise<void>
  
  // 실행 중인 컨테이너 목록
  list(): ContainerInstance[]
  
  // 컨테이너 상태 구독
  subscribe(containerId: string, callback: StateCallback): Unsubscribe
  
  // 리소스 정리
  async cleanup(): Promise<void>
}
```

#### ContainerManagerConfig

```typescript
interface ContainerManagerConfig {
  registry?: string                    // 컨테이너 레지스트리 URL
  maxContainers?: number              // 최대 동시 실행 컨테이너 수 (기본: 10)
  defaultRuntime?: WASMRuntime        // 기본 런타임 (기본: 'wasmtime')
  cacheSize?: number                  // 컨테이너 캐시 크기 (기본: 100MB)
  debugMode?: boolean                 // 디버그 모드 활성화
  enableMetrics?: boolean             // 메트릭 수집 활성화
  networkTimeout?: number             // 네트워크 타임아웃 (ms)
}
```

#### ContainerConfig

```typescript
interface ContainerConfig {
  maxMemory?: number                  // 최대 메모리 사용량 (bytes)
  maxCpuTime?: number                 // 최대 CPU 시간 (ms)
  allowedImports?: string[]           // 허용된 import 목록
  persistentData?: boolean            // 영구 데이터 저장 여부
  networkAccess?: boolean             // 네트워크 접근 허용
  isolation?: IsolationPolicy         // 격리 정책
  runtime?: WASMRuntime              // 사용할 런타임
  environment?: Record<string, string> // 환경 변수
}
```

#### IsolationPolicy

```typescript
interface IsolationPolicy {
  memoryIsolation: boolean            // 메모리 격리 활성화
  fileSystemAccess: boolean           // 파일 시스템 접근 제한
  crossContainerComm: boolean         // 컨테이너간 통신 허용
  syscallFilter?: string[]            // 허용된 시스템 콜 목록
  capabilities?: string[]             // Linux capabilities
}
```

### ContainerInstance

실행 중인 WASM 컨테이너 인스턴스를 나타냅니다.

```typescript
class ContainerInstance {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly status: ContainerStatus
  readonly metrics: ContainerMetrics
  
  // 함수 호출
  async call<T = any>(functionName: string, args?: any): Promise<T>
  
  // 상태 업데이트
  async updateState(state: any): Promise<void>
  
  // 상태 구독
  subscribe(callback: StateCallback): Unsubscribe
  
  // 메모리 사용량 조회
  getMemoryUsage(): MemoryUsage
  
  // 컨테이너 중지
  async stop(): Promise<void>
  
  // 헬스 체크
  async healthCheck(): Promise<HealthStatus>
}
```

#### ContainerStatus

```typescript
enum ContainerStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}
```

#### ContainerMetrics

```typescript
interface ContainerMetrics {
  cpuUsage: number                    // CPU 사용률 (%)
  memoryUsage: MemoryUsage           // 메모리 사용량
  uptime: number                     // 실행 시간 (ms)
  callCount: number                  // 총 함수 호출 수
  errorCount: number                 // 에러 발생 수
  lastActivity: Date                 // 마지막 활동 시간
}
```

#### MemoryUsage

```typescript
interface MemoryUsage {
  used: number                       // 사용 중인 메모리 (bytes)
  allocated: number                  // 할당된 메모리 (bytes)
  peak: number                       // 최대 사용량 (bytes)
  limit: number                      // 메모리 제한 (bytes)
}
```

## React Hooks

### useContainerState

React 컴포넌트에서 WASM 컨테이너 상태를 관리하는 메인 훅입니다.

```typescript
function useContainerState<T = any>(
  containerName: string,
  options?: UseContainerStateOptions<T>
): UseContainerStateResult<T>
```

#### UseContainerStateOptions

```typescript
interface UseContainerStateOptions<T> {
  initialState?: T                    // 초기 상태값
  autoStart?: boolean                // 자동 시작 여부 (기본: true)
  containerConfig?: ContainerConfig   // 컨테이너 설정
  onError?: (error: Error) => void   // 에러 핸들러
  onStateChange?: (state: T) => void // 상태 변경 핸들러
  suspense?: boolean                 // Suspense 모드 활성화
  retryCount?: number                // 재시도 횟수
  retryDelay?: number                // 재시도 지연 시간 (ms)
}
```

#### UseContainerStateResult

```typescript
interface UseContainerStateResult<T> {
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
```

### useContainerRegistry

컨테이너 레지스트리와 상호작용하는 훅입니다.

```typescript
function useContainerRegistry(): UseContainerRegistryResult

interface UseContainerRegistryResult {
  // 컨테이너 검색
  search: (query: string) => Promise<ContainerMetadata[]>
  
  // 컨테이너 다운로드
  pull: (name: string, version?: string) => Promise<ContainerMetadata>
  
  // 컨테이너 업로드
  push: (container: ContainerData) => Promise<void>
  
  // 로컬 컨테이너 목록
  list: () => Promise<ContainerMetadata[]>
  
  // 컨테이너 삭제
  remove: (name: string, version?: string) => Promise<void>
  
  // 캐시 정리
  prune: () => Promise<void>
}
```

### useContainerMetrics

컨테이너 메트릭을 모니터링하는 훅입니다.

```typescript
function useContainerMetrics(
  containerId: string,
  options?: UseContainerMetricsOptions
): ContainerMetrics

interface UseContainerMetricsOptions {
  refreshInterval?: number           // 새로고침 간격 (ms, 기본: 1000)
  enabled?: boolean                  // 메트릭 수집 활성화
}
```

### useContainerEvents

컨테이너 이벤트를 구독하는 훅입니다.

```typescript
function useContainerEvents(
  containerId: string,
  eventTypes?: ContainerEventType[]
): ContainerEvent[]

enum ContainerEventType {
  STATE_CHANGE = 'state_change',
  FUNCTION_CALL = 'function_call',
  ERROR = 'error',
  MEMORY_WARNING = 'memory_warning',
  CPU_THRESHOLD = 'cpu_threshold'
}

interface ContainerEvent {
  type: ContainerEventType
  timestamp: Date
  containerId: string
  data: any
}
```

## Provider Components

### ContainerProvider

전역 컨테이너 설정을 제공하는 Provider 컴포넌트입니다.

```typescript
interface ContainerProviderProps {
  config: ContainerManagerConfig
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error }>
}

function ContainerProvider(props: ContainerProviderProps): JSX.Element
```

사용 예제:

```typescript
<ContainerProvider
  config={{
    registry: 'https://registry.gaesup.dev',
    maxContainers: 5,
    debugMode: process.env.NODE_ENV === 'development'
  }}
  fallback={ErrorBoundary}
>
  <App />
</ContainerProvider>
```

### ContainerSuspense

컨테이너 로딩 상태를 처리하는 Suspense 컴포넌트입니다.

```typescript
interface ContainerSuspenseProps {
  fallback: React.ReactNode
  children: React.ReactNode
  onError?: (error: Error) => void
}

function ContainerSuspense(props: ContainerSuspenseProps): JSX.Element
```

## Utility Functions

### createContainer

프로그래매틱하게 컨테이너를 생성하는 유틸리티 함수입니다.

```typescript
async function createContainer(
  name: string,
  config?: ContainerConfig
): Promise<ContainerInstance>
```

### compileWASM

TypeScript/JavaScript 코드를 WASM으로 컴파일하는 함수입니다.

```typescript
async function compileWASM(
  source: string,
  options?: CompileOptions
): Promise<WebAssembly.Module>

interface CompileOptions {
  target?: 'wasm32-wasi' | 'wasm32-unknown'
  optimization?: 'none' | 'size' | 'speed'
  debug?: boolean
  imports?: Record<string, any>
}
```

### validateContainer

컨테이너 유효성을 검사하는 함수입니다.

```typescript
async function validateContainer(
  container: ContainerData
): Promise<ValidationResult>

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}
```

## Error Types

### ContainerError

컨테이너 관련 에러의 기본 클래스입니다.

```typescript
class ContainerError extends Error {
  readonly code: string
  readonly containerId?: string
  readonly details?: any
  
  constructor(message: string, code: string, details?: any)
}
```

### 구체적인 에러 타입들

```typescript
class ContainerNotFoundError extends ContainerError {}
class ContainerStartupError extends ContainerError {}
class ContainerMemoryError extends ContainerError {}
class ContainerTimeoutError extends ContainerError {}
class ContainerSecurityError extends ContainerError {}
class RegistryError extends ContainerError {}
class CompilationError extends ContainerError {}
```

## Configuration Objects

### WASMRuntime

지원되는 WASM 런타임 타입입니다.

```typescript
type WASMRuntime = 
  | 'wasmtime'
  | 'wasmedge'  
  | 'wasmer'
  | 'browser'
  | 'nodejs'
```

### LogLevel

로깅 레벨을 정의합니다.

```typescript
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}
```

### PerformanceConfig

성능 관련 설정입니다.

```typescript
interface PerformanceConfig {
  enableProfiling?: boolean          // 프로파일링 활성화
  collectMetrics?: boolean           // 메트릭 수집
  gcThreshold?: number              // GC 임계값 (%)
  memoryPoolSize?: number           // 메모리 풀 크기
  workerThreads?: number            // 워커 스레드 수
}
```

## Event System

### EventBus

컨테이너간 통신을 위한 이벤트 버스입니다.

```typescript
class EventBus {
  // 이벤트 발행
  emit(event: string, data: any): void
  
  // 이벤트 구독
  on(event: string, callback: EventCallback): Unsubscribe
  
  // 일회성 이벤트 구독
  once(event: string, callback: EventCallback): void
  
  // 이벤트 구독 해제
  off(event: string, callback: EventCallback): void
  
  // 모든 리스너 제거
  removeAllListeners(event?: string): void
}
```

### ContainerEvents

컨테이너에서 발생하는 표준 이벤트들입니다.

```typescript
interface ContainerEvents {
  'container:start': { containerId: string }
  'container:stop': { containerId: string }
  'container:error': { containerId: string, error: Error }
  'state:change': { containerId: string, state: any }
  'function:call': { containerId: string, functionName: string, args: any }
  'memory:warning': { containerId: string, usage: MemoryUsage }
  'cpu:threshold': { containerId: string, usage: number }
}
```

## Type Definitions

### 기본 타입들

```typescript
type StateCallback = (state: any) => void
type ErrorCallback = (error: Error) => void
type Unsubscribe = () => void

type ContainerID = string
type ContainerVersion = string
type FunctionName = string

type SerializableValue = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue }
```

### 고급 타입들

```typescript
// 컨테이너 메타데이터
interface ContainerMetadata {
  name: string
  version: string
  description?: string
  author?: string
  license?: string
  repository?: string
  keywords?: string[]
  size: number
  hash: string
  createdAt: Date
  updatedAt: Date
  dependencies?: string[]
  exports?: FunctionSignature[]
}

// 함수 시그니처
interface FunctionSignature {
  name: string
  parameters: ParameterInfo[]
  returnType: TypeInfo
  description?: string
}

interface ParameterInfo {
  name: string
  type: TypeInfo
  optional?: boolean
  default?: any
}

interface TypeInfo {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  itemType?: TypeInfo  // array의 경우
  properties?: Record<string, TypeInfo>  // object의 경우
}
```

## 사용 예제

### 기본 사용법

```typescript
import { ContainerManager, useContainerState } from '@gaesup-state/core'

// ContainerManager 직접 사용
const manager = new ContainerManager({
  registry: 'https://registry.gaesup.dev'
})

const container = await manager.run('math-utils:1.0.0')
const result = await container.call('fibonacci', [40])

// React Hook 사용
function MyComponent() {
  const { state, call, isLoading } = useContainerState('counter:1.0.0', {
    initialState: 0
  })
  
  const increment = () => call('increment')
  
  return (
    <div>
      <span>Count: {state}</span>
      <button onClick={increment} disabled={isLoading}>
        +1
      </button>
    </div>
  )
}
```

### 고급 사용법

```typescript
// 커스텀 에러 핸들링
const { state, error } = useContainerState('risky-operation:1.0.0', {
  onError: (error) => {
    if (error instanceof ContainerMemoryError) {
      // 메모리 부족 시 처리
      console.warn('메모리 부족, 캐시 정리 중...')
    }
  },
  retryCount: 3,
  retryDelay: 1000
})

// 메트릭 모니터링
const metrics = useContainerMetrics(containerId, {
  refreshInterval: 500
})

console.log(`CPU: ${metrics.cpuUsage}%, Memory: ${metrics.memoryUsage.used}`)

// 이벤트 구독
const events = useContainerEvents(containerId, [
  ContainerEventType.STATE_CHANGE,
  ContainerEventType.ERROR
])
```

이 API 레퍼런스는 Gaesup-State의 모든 주요 기능과 타입을 포괄적으로 다룹니다. 각 API는 TypeScript로 완전히 타입화되어 있어 개발 중 자동완성과 타입 안전성을 제공합니다. 