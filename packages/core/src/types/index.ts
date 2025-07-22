// 기본 타입들
export type StateCallback = (state: any) => void
export type ErrorCallback = (error: Error) => void
export type Unsubscribe = () => void

export type ContainerID = string
export type ContainerVersion = string
export type FunctionName = string

export type SerializableValue = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue }

// WASM 런타임 타입
export type WASMRuntimeType = 
  | 'wasmtime'
  | 'wasmedge'  
  | 'wasmer'
  | 'browser'
  | 'nodejs'

// 컨테이너 상태
export enum ContainerStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

// 메모리 사용량
export interface MemoryUsage {
  used: number                       // 사용 중인 메모리 (bytes)
  allocated: number                  // 할당된 메모리 (bytes)
  peak: number                       // 최대 사용량 (bytes)
  limit: number                      // 메모리 제한 (bytes)
}

// 컨테이너 메트릭
export interface ContainerMetrics {
  cpuUsage: number                    // CPU 사용률 (%)
  memoryUsage: MemoryUsage           // 메모리 사용량
  uptime: number                     // 실행 시간 (ms)
  callCount: number                  // 총 함수 호출 수
  errorCount: number                 // 에러 발생 수
  lastActivity: Date                 // 마지막 활동 시간
}

// 격리 정책
export interface IsolationPolicy {
  memoryIsolation: boolean            // 메모리 격리 활성화
  fileSystemAccess: boolean           // 파일 시스템 접근 제한
  crossContainerComm: boolean         // 컨테이너간 통신 허용
  syscallFilter?: string[]            // 허용된 시스템 콜 목록
  capabilities?: string[]             // Linux capabilities
}

// 컨테이너 설정
export interface ContainerConfig {
  maxMemory?: number                  // 최대 메모리 사용량 (bytes)
  maxCpuTime?: number                 // 최대 CPU 시간 (ms)
  allowedImports?: string[]           // 허용된 import 목록
  persistentData?: boolean            // 영구 데이터 저장 여부
  networkAccess?: boolean             // 네트워크 접근 허용
  isolation?: IsolationPolicy         // 격리 정책
  runtime?: WASMRuntimeType          // 사용할 런타임
  environment?: Record<string, string> // 환경 변수
}

// 컨테이너 매니저 설정
export interface ContainerManagerConfig {
  registry?: string                    // 컨테이너 레지스트리 URL
  maxContainers?: number              // 최대 동시 실행 컨테이너 수 (기본: 10)
  defaultRuntime?: WASMRuntimeType    // 기본 런타임 (기본: 'wasmtime')
  cacheSize?: number                  // 컨테이너 캐시 크기 (기본: 100MB)
  debugMode?: boolean                 // 디버그 모드 활성화
  enableMetrics?: boolean             // 메트릭 수집 활성화
  networkTimeout?: number             // 네트워크 타임아웃 (ms)
}

// 컨테이너 메타데이터
export interface ContainerMetadata {
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
export interface FunctionSignature {
  name: string
  parameters: ParameterInfo[]
  returnType: TypeInfo
  description?: string
}

export interface ParameterInfo {
  name: string
  type: TypeInfo
  optional?: boolean
  default?: any
}

export interface TypeInfo {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  itemType?: TypeInfo  // array의 경우
  properties?: Record<string, TypeInfo>  // object의 경우
}

// 성능 설정
export interface PerformanceConfig {
  enableProfiling?: boolean          // 프로파일링 활성화
  collectMetrics?: boolean           // 메트릭 수집
  gcThreshold?: number              // GC 임계값 (%)
  memoryPoolSize?: number           // 메모리 풀 크기
  workerThreads?: number            // 워커 스레드 수
}

// 로깅 레벨
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

// 이벤트 타입
export enum ContainerEventType {
  STATE_CHANGE = 'state_change',
  FUNCTION_CALL = 'function_call',
  ERROR = 'error',
  MEMORY_WARNING = 'memory_warning',
  CPU_THRESHOLD = 'cpu_threshold'
}

export interface ContainerEvent {
  type: ContainerEventType
  timestamp: Date
  containerId: string
  data: any
}

// 헬스 상태
export interface HealthStatus {
  healthy: boolean
  lastCheck: Date
  details?: Record<string, any>
}

// 컴파일 옵션
export interface CompileOptions {
  target?: 'wasm32-wasi' | 'wasm32-unknown'
  optimization?: 'none' | 'size' | 'speed'
  debug?: boolean
  imports?: Record<string, any>
}

// 유효성 검사 결과
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  code: string
  message: string
  location?: string
}

export interface ValidationWarning {
  code: string
  message: string
  location?: string
} 

export interface Container {
  id: string;
  name: string;
  framework: 'react' | 'vue' | 'svelte' | 'angular' | 'vanilla';
  metadata: ContainerMetadata;
}

// Add new types
export interface Action<T = any> {
  type: string;
  payload?: T;
}

export interface StateListener {
  (state: any): void;
}

export interface StoreMetrics {
  store_id: string;
  subscriber_count: number;
  last_update_time: string;
  total_updates: number;
  memory_usage_bytes: number;
}

export interface BatchUpdateInstance {
  add_update(actionType: string, payload: any): void;
  execute(): Promise<any>;
}

export interface GaesupSnapshot {
  id: string;
  store_id: string;
  state: any;
  created_at: string;
} 