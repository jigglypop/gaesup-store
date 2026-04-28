/**
 * Redux DevTools 연결을 위한 브리지
 * WASM 컨테이너 상태를 Redux DevTools에서 시각화
 */

interface DevToolsExtension {
  connect(options?: any): DevToolsConnection;
}

interface DevToolsConnection {
  init(state: any): void;
  send(action: any, state: any): void;
  subscribe(listener: (message: any) => void): () => void;
  unsubscribe(): void;
}

interface StateAction {
  type: string;
  containerId: string;
  functionName?: string;
  framework?: string;
  timestamp: number;
  payload?: any;
}

export class ReduxDevToolsBridge {
  private devtools: DevToolsConnection | null = null;
  private isConnected = false;
  private stateHistory: any[] = [];
  private currentState: Record<string, any> = {};

  constructor(name: string = 'Gaesup WASM Containers') {
    this.connect(name);
  }

  private connect(name: string) {
    // Redux DevTools Extension 확인
    const extension = (window as any).__REDUX_DEVTOOLS_EXTENSION__;
    if (!extension) {
      console.warn('🔧 Redux DevTools Extension이 설치되지 않았습니다.');
      return;
    }

    try {
      this.devtools = extension.connect({
        name,
        features: {
          pause: true,
          lock: true,
          persist: true,
          export: true,
          import: 'custom',
          jump: true,
          skip: true,
          reorder: true,
          dispatch: true,
          test: true
        },
        trace: true,
        traceLimit: 25
      });

      // 초기 상태 설정
      this.devtools!.init(this.currentState);
      
      // DevTools에서 오는 메시지 처리
      this.devtools!.subscribe((message: any) => {
        this.handleDevToolsMessage(message);
      });

      this.isConnected = true;
      console.log('🔧 Redux DevTools 연결 완료!');
      
    } catch (error) {
      console.error('❌ Redux DevTools 연결 실패:', error);
    }
  }

  /**
   * 컨테이너 상태 변경을 DevTools에 전송
   */
  dispatch(action: StateAction, newState: Record<string, any>) {
    if (!this.devtools || !this.isConnected) return;

    // 상태 업데이트
    this.currentState = { ...newState };
    this.stateHistory.push({
      action,
      state: this.currentState,
      timestamp: Date.now()
    });

    // DevTools에 전송
    this.devtools.send(action, this.currentState);
  }

  /**
   * 컨테이너 생성 액션
   */
  containerCreated(containerId: string, framework: string, initialState: any) {
    this.currentState[containerId] = {
      id: containerId,
      framework,
      state: initialState,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    this.dispatch({
      type: '🚀 CONTAINER_CREATED',
      containerId,
      framework,
      timestamp: Date.now(),
      payload: initialState
    }, this.currentState);
  }

  /**
   * 함수 호출 액션
   */
  functionCalled(containerId: string, functionName: string, framework: string, result: any, newState: any) {
    if (this.currentState[containerId]) {
      this.currentState[containerId] = {
        ...this.currentState[containerId],
        state: newState,
        lastUpdated: new Date().toISOString(),
        lastFunction: functionName,
        lastResult: result
      };
    }

    this.dispatch({
      type: `🔧 ${functionName.toUpperCase()}`,
      containerId,
      functionName,
      framework,
      timestamp: Date.now(),
      payload: { result, newState }
    }, this.currentState);
  }

  /**
   * 컨테이너 제거 액션
   */
  containerRemoved(containerId: string) {
    delete this.currentState[containerId];

    this.dispatch({
      type: '🗑️ CONTAINER_REMOVED',
      containerId,
      timestamp: Date.now()
    }, this.currentState);
  }

  /**
   * 에러 액션
   */
  errorOccurred(containerId: string, error: Error, context?: string) {
    this.dispatch({
      type: '❌ ERROR',
      containerId,
      timestamp: Date.now(),
      payload: {
        message: error.message,
        stack: error.stack,
        context
      }
    }, this.currentState);
  }

  /**
   * DevTools에서 오는 메시지 처리
   */
  private handleDevToolsMessage(message: any) {
    switch (message.type) {
      case 'DISPATCH':
        console.log('🔧 DevTools 디스패치:', message);
        // 타임 트래블이나 상태 점프 처리
        if (message.payload?.type === 'JUMP_TO_STATE' || message.payload?.type === 'JUMP_TO_ACTION') {
          console.log('⏰ 상태 점프 요청:', message.state);
          // 여기서 실제 상태를 복원할 수 있음
        }
        break;
        
      case 'START':
        console.log('🔧 DevTools 모니터링 시작');
        break;
        
      case 'STOP':
        console.log('🔧 DevTools 모니터링 정지');
        break;
    }
  }

  /**
   * 현재 전체 상태 반환
   */
  getState() {
    return this.currentState;
  }

  /**
   * 상태 히스토리 반환
   */
  getHistory() {
    return this.stateHistory;
  }

  /**
   * 연결 상태 확인
   */
  isDevToolsConnected() {
    return this.isConnected;
  }

  /**
   * 연결 해제
   */
  disconnect() {
    if (this.devtools) {
      this.devtools.unsubscribe();
      this.devtools = null;
      this.isConnected = false;
      console.log('🔧 Redux DevTools 연결 해제');
    }
  }
}

// 전역 DevTools 브리지 인스턴스
let globalDevToolsBridge: ReduxDevToolsBridge | null = null;

/**
 * 전역 DevTools 브리지 가져오기
 */
export function getDevToolsBridge(): ReduxDevToolsBridge {
  if (!globalDevToolsBridge) {
    globalDevToolsBridge = new ReduxDevToolsBridge('🚀 Gaesup WASM Containers');
  }
  return globalDevToolsBridge;
}

/**
 * DevTools 브리지 정리
 */
export function cleanupDevToolsBridge() {
  if (globalDevToolsBridge) {
    globalDevToolsBridge.disconnect();
    globalDevToolsBridge = null;
  }
} 
