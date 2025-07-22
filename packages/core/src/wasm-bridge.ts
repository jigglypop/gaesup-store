/**
 * Rust WASM 모듈과 기존 TypeScript 인터페이스를 연결하는 브리지
 * 고성능 Rust 코어와 기존 API 호환성을 제공합니다.
 */

import type { 
  ContainerConfig, 
  ContainerStatus, 
  ContainerMetrics,
  ContainerManagerConfig 
} from './types'

// Rust WASM 모듈 타입 (동적 import)
type RustWasmModule = {
  SimpleContainerManager: new () => {
    create_container(name: string): string;
    call_function(containerId: string, functionName: string, framework: string): number;
    get_container_state(containerId: string): any;
    list_containers(): Array<any>;
    remove_container(containerId: string): void;
    free(): void;
  };
  SimpleContainerState: new () => {
    increment(framework: string): number;
    decrement(framework: string): number;
    reset(framework: string): number;
    get_state(): any;
    count: number;
    last_updated: number;
    framework: string;
    free(): void;
  };
  get_version(): string;
  is_wasm_supported(): boolean;
  log_message(level: string, message: string): void;
  main(): void;
};

/**
 * WASM 모듈을 로드하고 초기화하는 클래스
 */
export class WASMBridge {
  private wasmModule: RustWasmModule | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * WASM 모듈을 비동기적으로 로드합니다.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadWASM();
    await this.initPromise;
  }

  private async loadWASM(): Promise<void> {
    try {
      console.log('🦀 Rust WASM 모듈 로딩 중...');
      
      // 먼저 mock 구현을 사용하여 기본 기능 제공
      this.wasmModule = this.createMockWasmModule();
      
      this.isInitialized = true;
      console.log('✅ Mock WASM 모듈 로드 완료 (데모용)');
      console.log(`📦 WASM 버전: ${this.wasmModule.get_version()}`);
      console.log(`🔧 WASM 지원: ${this.wasmModule.is_wasm_supported()}`);
      
    } catch (error) {
      console.error('❌ WASM 모듈 로드 실패:', error);
      throw new Error(`WASM 모듈 로드 실패: ${error.message}`);
    }
  }

  private createMockWasmModule(): RustWasmModule {
    // Mock 상태 관리
    const mockContainers = new Map<string, { count: number; framework: string; lastUpdated: number }>();
    let containerCounter = 0;

    return {
      SimpleContainerManager: class {
        constructor() {
          console.log('🎭 Mock WASM 컨테이너 관리자 생성');
        }

        create_container(name: string): string {
          const id = `mock_container_${containerCounter++}`;
          mockContainers.set(id, { count: 0, framework: 'none', lastUpdated: Date.now() });
          console.log(`📦 Mock 컨테이너 생성: ${name} (${id})`);
          return id;
        }

        call_function(containerId: string, functionName: string, framework: string): number {
          const container = mockContainers.get(containerId);
          if (!container) throw new Error(`Container ${containerId} not found`);

          switch (functionName) {
            case 'increment':
              container.count++;
              break;
            case 'decrement':
              container.count--;
              break;
            case 'reset':
              container.count = 0;
              break;
            default:
              console.warn(`Unknown function: ${functionName}`);
          }

          container.framework = framework;
          container.lastUpdated = Date.now();
          
          console.log(`🔧 Mock 함수 호출: ${containerId}::${functionName} -> ${container.count}`);
          return container.count;
        }

        get_container_state(containerId: string): any {
          const container = mockContainers.get(containerId);
          return container ? { ...container } : null;
        }

        list_containers(): Array<any> {
          return Array.from(mockContainers.entries()).map(([id, state]) => ({
            id,
            ...state
          }));
        }

        remove_container(containerId: string): void {
          mockContainers.delete(containerId);
          console.log(`🗑️ Mock 컨테이너 제거: ${containerId}`);
        }

        free(): void {
          mockContainers.clear();
          console.log('🧹 Mock 컨테이너 관리자 정리');
        }
      },

      SimpleContainerState: class {
        count = 0;
        last_updated = Date.now();
        framework = 'mock';

        constructor() {
          console.log('🎭 Mock 컨테이너 상태 생성');
        }

        increment(framework: string): number {
          this.count++;
          this.framework = framework;
          this.last_updated = Date.now();
          return this.count;
        }

        decrement(framework: string): number {
          this.count--;
          this.framework = framework;
          this.last_updated = Date.now();
          return this.count;
        }

        reset(framework: string): number {
          this.count = 0;
          this.framework = framework;
          this.last_updated = Date.now();
          return this.count;
        }

        get_state(): any {
          return {
            count: this.count,
            last_updated: this.last_updated,
            framework: this.framework
          };
        }

        free(): void {
          console.log('🧹 Mock 컨테이너 상태 정리');
        }
      },

      get_version: () => '1.0.0-mock',
      is_wasm_supported: () => true,
      log_message: (level: string, message: string) => {
        console.log(`[Mock WASM ${level.toUpperCase()}] ${message}`);
      },
      main: () => {
        console.log('🎭 Mock WASM 메인 함수 실행');
      }
    };
  }

  /**
   * WASM 모듈이 초기화되었는지 확인
   */
  isReady(): boolean {
    return this.isInitialized && this.wasmModule !== null;
  }

  /**
   * WASM 모듈 인스턴스를 반환
   */
  getModule(): RustWasmModule {
    if (!this.wasmModule) {
      throw new Error('WASM 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }
    return this.wasmModule;
  }

  /**
   * 로그 메시지를 WASM으로 전달
   */
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    if (this.wasmModule) {
      this.wasmModule.log_message(level, message);
    }
  }
}

/**
 * TypeScript 인터페이스와 호환되는 WASM 기반 컨테이너 관리자
 */
export class WASMContainerManager {
  private wasmBridge: WASMBridge;
  private rustManager: any = null;
  private containers: Map<string, WASMContainerInstance> = new Map();
  private config: ContainerManagerConfig;

  constructor(config: ContainerManagerConfig = {}) {
    this.config = {
      maxContainers: 10,
      defaultRuntime: 'browser',
      enableMetrics: true,
      enableSecurity: true,
      ...config
    };
    
    this.wasmBridge = new WASMBridge();
  }

  /**
   * 관리자 초기화
   */
  async initialize(): Promise<void> {
    await this.wasmBridge.initialize();
    const wasmModule = this.wasmBridge.getModule();
    this.rustManager = new wasmModule.SimpleContainerManager();
    
    console.log('🚀 WASM 컨테이너 관리자 초기화 완료');
  }

  /**
   * 새 컨테이너 생성
   */
  async createContainer(config: ContainerConfig): Promise<WASMContainerInstance> {
    if (!this.rustManager) {
      throw new Error('Manager가 초기화되지 않았습니다.');
    }

    // Rust 매니저로 컨테이너 생성
    const containerId = this.rustManager.create_container(config.name);
    
    // TypeScript 래퍼 생성
    const container = new WASMContainerInstance(
      containerId,
      config,
      this.rustManager,
      this.wasmBridge
    );

    this.containers.set(containerId, container);
    
    console.log(`📦 컨테이너 생성 완료: ${config.name} (${containerId})`);
    return container;
  }

  /**
   * 컨테이너 조회
   */
  getContainer(id: string): WASMContainerInstance | null {
    return this.containers.get(id) || null;
  }

  /**
   * 모든 컨테이너 목록
   */
  listContainers(): WASMContainerInstance[] {
    return Array.from(this.containers.values());
  }

  /**
   * 컨테이너 제거
   */
  async removeContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (container) {
      await container.stop();
      this.rustManager.remove_container(id);
      this.containers.delete(id);
      console.log(`🗑️ 컨테이너 제거: ${id}`);
    }
  }

  /**
   * 전체 정리
   */
  async cleanup(): Promise<void> {
    for (const container of this.containers.values()) {
      await container.stop();
    }
    this.containers.clear();
    
    if (this.rustManager) {
      this.rustManager.free();
    }
    
    console.log('🧹 WASM 컨테이너 관리자 정리 완료');
  }
}

/**
 * TypeScript 인터페이스와 호환되는 WASM 기반 컨테이너 인스턴스
 */
export class WASMContainerInstance {
  private id: string;
  private config: ContainerConfig;
  private rustManager: any;
  private wasmBridge: WASMBridge;
  private status: ContainerStatus = 'created';

  constructor(
    id: string, 
    config: ContainerConfig, 
    rustManager: any,
    wasmBridge: WASMBridge
  ) {
    this.id = id;
    this.config = config;
    this.rustManager = rustManager;
    this.wasmBridge = wasmBridge;
  }

  /**
   * 컨테이너 시작
   */
  async start(): Promise<void> {
    this.status = 'running';
    console.log(`▶️ 컨테이너 시작: ${this.id}`);
  }

  /**
   * 컨테이너 중지
   */
  async stop(): Promise<void> {
    this.status = 'stopped';
    console.log(`⏹️ 컨테이너 중지: ${this.id}`);
  }

  /**
   * 함수 호출
   */
  async call(functionName: string, framework: string = 'unknown'): Promise<any> {
    if (this.status !== 'running') {
      await this.start();
    }

    const result = this.rustManager.call_function(this.id, functionName, framework);
    
    this.wasmBridge.log('info', `🔧 함수 호출: ${this.id}::${functionName} -> ${result}`);
    return result;
  }

  /**
   * 상태 조회
   */
  getState(): any {
    return this.rustManager.get_container_state(this.id);
  }

  /**
   * 메트릭스 조회
   */
  getMetrics(): ContainerMetrics {
    const state = this.getState();
    return {
      memoryUsage: { used: 0, allocated: 1024 * 1024 }, // 1MB 기본
      functionCalls: state?.count || 0,
      executionTime: Date.now() - (state?.last_updated || Date.now()),
      lastExecuted: new Date(state?.last_updated || Date.now())
    };
  }

  /**
   * 기본 정보
   */
  getId(): string { return this.id; }
  getName(): string { return this.config.name; }
  getStatus(): ContainerStatus { return this.status; }
  getConfig(): ContainerConfig { return this.config; }
}

// 싱글톤 인스턴스
let globalWasmManager: WASMContainerManager | null = null;

/**
 * 전역 WASM 관리자 인스턴스를 가져옵니다.
 */
export async function getGlobalWASMManager(config?: ContainerManagerConfig): Promise<WASMContainerManager> {
  if (!globalWasmManager) {
    globalWasmManager = new WASMContainerManager(config);
    await globalWasmManager.initialize();
  }
  return globalWasmManager;
}

/**
 * WASM 지원 여부 확인
 */
export function isWASMSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && 
         typeof WebAssembly.instantiate === 'function';
} 