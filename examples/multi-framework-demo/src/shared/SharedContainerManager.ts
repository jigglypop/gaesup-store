import { createOptimalContainerManager, WASMContainerManager, ContainerManager, getDevToolsBridge, ReduxDevToolsBridge } from 'gaesup-state';
import type { ContainerConfig } from 'gaesup-state';
// TODO: adapter 패키지 완성 후 다시 활성화
// import { createFrameworkAdapter } from '@gaesup-state/adapter';

export interface SharedStateEvent {
  type: 'stateChange' | 'containerStart' | 'containerStop' | 'error';
  containerId: string;
  data: any;
  timestamp: number;
}

export class SharedContainerManager {
  private static instance: SharedContainerManager;
  private containerManager: WASMContainerManager | ContainerManager | null = null;
  private eventTarget: EventTarget;
  private adapters = new Map<string, any>();
  private isWasmEnabled = false;
  private devTools: ReduxDevToolsBridge; // Redux DevTools 활성화

  private constructor() {
    this.eventTarget = new EventTarget();
    this.devTools = getDevToolsBridge(); // Redux DevTools 활성화
  }

  static getInstance(): SharedContainerManager {
    if (!SharedContainerManager.instance) {
      SharedContainerManager.instance = new SharedContainerManager();
    }
    return SharedContainerManager.instance;
  }

  /**
   * 컨테이너 매니저 초기화 (WASM 또는 TypeScript)
   */
  async initialize(): Promise<void> {
    if (this.containerManager) return;

    try {
      console.log('🚀 SharedContainerManager 초기화 중...');
      
      this.containerManager = await createOptimalContainerManager({
        maxContainers: 10,
        defaultRuntime: 'browser',
        enableMetrics: true,
        enableSecurity: true,
        useWASM: true // WASM 사용 강제 활성화
      });

      // WASM 매니저인지 확인
      this.isWasmEnabled = this.containerManager instanceof (await import('gaesup-state')).WASMContainerManager;
      
      console.log(`✅ 컨테이너 매니저 초기화 완료 (${this.isWasmEnabled ? 'WASM' : 'TypeScript'})`);
      
      this.setupEventListeners();
      
    } catch (error) {
      console.error('❌ 컨테이너 매니저 초기화 실패:', error);
      throw error;
    }
  }

  registerFrameworkAdapter(frameworkName: string, reactivitySystem: any) {
    // TODO: adapter 패키지 완성 후 활성화
    console.log(`📱 프레임워크 어댑터 등록 (임시 비활성화): ${frameworkName}`);
    
    // const adapter = createFrameworkAdapter(reactivitySystem); // 임시 비활성화
    // this.adapters.set(frameworkName, adapter);

    // adapter.onStateChange = (containerId: string, newState: any) => { // 임시 비활성화
    //   this.broadcastEvent({
    //     type: 'stateChange',
    //     containerId,
    //     data: newState,
    //     timestamp: Date.now()
    //   });
    // };

    return null; // 임시 비활성화
  }

  async createContainer(name: string = 'shared-container'): Promise<string> {
    if (!this.containerManager) {
      throw new Error('Container manager not initialized');
    }

    try {
      // WASMContainerManager의 경우 ContainerConfig 객체가 필요
      if (this.isWasmEnabled && 'createContainer' in this.containerManager) {
        const containerInstance = await this.containerManager.createContainer({ name });
        const containerId = containerInstance.getId(); // WASMContainerInstance에서 ID 가져오기
        
        // DevTools에 컨테이너 생성 알림
        const initialState = this.getContainerState(containerId);
        this.devTools.containerCreated(containerId, 'Multi-Framework', initialState);
        
        console.log(`✅ 컨테이너 생성 완료: ${containerId}`);
        
        this.broadcastEvent({
          type: 'containerStart',
          containerId,
          data: { name, initialState },
          timestamp: Date.now()
        });

        return containerId;
      } else {
        // TypeScript 매니저 폴백
        const containerId = await this.containerManager.run(name);
        
        // DevTools에 컨테이너 생성 알림
        const initialState = this.getContainerState(containerId);
        this.devTools.containerCreated(containerId, 'Multi-Framework', initialState);
        
        console.log(`✅ 컨테이너 생성 완료: ${containerId}`);
        
        this.broadcastEvent({
          type: 'containerStart',
          containerId,
          data: { name, initialState },
          timestamp: Date.now()
        });

        return containerId;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ 컨테이너 생성 실패:', errorMsg);
      
      // DevTools에 에러 알림
      this.devTools.errorOccurred('unknown', new Error(errorMsg), 'createContainer');
      
      throw error;
    }
  }

  async callContainerFunction(containerId: string, functionName: string, framework: string = 'unknown'): Promise<any> {
    if (!this.containerManager) {
      throw new Error('Container manager not initialized');
    }

    try {
      let result: any;

      if (this.isWasmEnabled && 'getContainer' in this.containerManager) {
        // WASM 매니저 사용 - 컨테이너 인스턴스 가져와서 call 메서드 호출
        const containerInstance = this.containerManager.getContainer(containerId);
        if (!containerInstance) {
          throw new Error(`Container ${containerId} not found`);
        }
        result = await containerInstance.call(functionName, framework);
      } else {
        // TypeScript 매니저 폴백
        const containerInstance = this.containerManager.getContainer(containerId);
        if (!containerInstance) {
          throw new Error(`Container ${containerId} not found`);
        }
        result = await containerInstance.call(functionName, []);
      }

      // 함수 호출 후 새로운 상태 가져오기
      const newState = this.getContainerState(containerId);
      
      // DevTools에 함수 호출 알림
      this.devTools.functionCalled(containerId, functionName, framework, result, newState);

      console.log(`🔧 함수 호출 완료: ${containerId}::${functionName} -> ${result}`);

      this.broadcastEvent({
        type: 'stateChange',
        containerId,
        data: { functionName, result, newState, framework },
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ 함수 호출 실패:', errorMsg);
      
      // DevTools에 에러 알림
      this.devTools.errorOccurred(containerId, new Error(errorMsg), `callFunction:${functionName}`);
      
      throw error;
    }
  }

  getContainerState(containerId: string): any {
    if (!this.containerManager) {
      console.warn('Container manager not initialized');
      return null;
    }

    const container = this.containerManager.getContainer(containerId);
    return container ? container.getState() : null;
  }

  getContainerMetrics(containerId: string) {
    if (!this.containerManager) {
      console.warn('Container manager not initialized');
      return null;
    }

    const container = this.containerManager.getContainer(containerId);
    return container ? container.getMetrics() : null;
  }

  getAllContainers() {
    if (!this.containerManager) {
      return [];
    }
    return this.containerManager.listContainers();
  }

  addEventListener(type: string, listener: (event: CustomEvent<SharedStateEvent>) => void) {
    this.eventTarget.addEventListener(type, listener as EventListener);
  }

  removeEventListener(type: string, listener: (event: CustomEvent<SharedStateEvent>) => void) {
    this.eventTarget.removeEventListener(type, listener as EventListener);
  }

  async stopContainer(containerId: string): Promise<void> {
    if (!this.containerManager) return;

    const container = this.containerManager.getContainer(containerId);
    if (container) {
      await container.stop();
      this.broadcastEvent({
        type: 'containerStop',
        containerId,
        data: { status: container.getStatus() },
        timestamp: Date.now()
      });
    }
  }

  async cleanup(): Promise<void> {
    if (this.containerManager) {
      await this.containerManager.cleanup();
    }
  }

  /**
   * WASM 사용 여부 확인
   */
  isUsingWasm(): boolean {
    return this.isWasmEnabled;
  }

  /**
   * 현재 상태 정보
   */
  getSystemInfo() {
    return {
      isWasmEnabled: this.isWasmEnabled,
      containerCount: this.getAllContainers().length,
      adapters: Array.from(this.adapters.keys()),
      initialized: !!this.containerManager
    };
  }

  private setupEventListeners() {
    // 기존 이벤트 리스너는 WASM/TypeScript 구분 없이 동일하게 동작
    if (this.containerManager && 'on' in this.containerManager) {
      this.containerManager.on('container:created', (data: any) => {
        this.broadcastEvent({
          type: 'containerStart',
          containerId: data.id,
          data,
          timestamp: Date.now()
        });
      });

      this.containerManager.on('container:error', (data: any) => {
        this.broadcastEvent({
          type: 'error',
          containerId: data.containerId || '',
          data,
          timestamp: Date.now()
        });
      });
    }
  }

  private broadcastEvent(eventData: SharedStateEvent) {
    const customEvent = new CustomEvent('shared-container-event', {
      detail: eventData
    });
    this.eventTarget.dispatchEvent(customEvent);

    // 전역 이벤트도 발송
    window.dispatchEvent(new CustomEvent(`gaesup:${eventData.type}`, {
      detail: { ...eventData, systemInfo: this.getSystemInfo() }
    }));
  }
}

// 전역 인스턴스 설정
(window as any).GaesupSharedManager = SharedContainerManager.getInstance();

export default SharedContainerManager; 