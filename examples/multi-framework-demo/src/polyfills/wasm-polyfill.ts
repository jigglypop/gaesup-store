/**
 * WASM 컨테이너 데모를 위한 폴리필 및 목 구현
 * 실제 WASM 모듈 없이도 데모가 동작할 수 있도록 함
 */

interface MockWASMState {
  count: number;
  lastUpdated: number;
  framework: string;
}

interface MockWASMExports {
  increment: (framework: string) => number;
  decrement: (framework: string) => number;
  reset: (framework: string) => number;
  getState: () => MockWASMState;
  setState: (state: MockWASMState) => void;
  memory: WebAssembly.Memory;
}

class MockWASMModule {
  private state: MockWASMState = {
    count: 0,
    lastUpdated: Date.now(),
    framework: 'none'
  };

  private memory = new WebAssembly.Memory({ initial: 1 });
  private functionCallCount = 0;
  private executionTimes: number[] = [];

  constructor() {
    console.log('🎭 Mock WASM 모듈 초기화');
  }

  getExports(): MockWASMExports {
    return {
      increment: (framework: string) => {
        const start = performance.now();
        this.state.count++;
        this.state.lastUpdated = Date.now();
        this.state.framework = framework;
        this.functionCallCount++;
        
        const end = performance.now();
        this.executionTimes.push(end - start);
        
        console.log(`📈 [${framework}] Count incremented to ${this.state.count}`);
        return this.state.count;
      },

      decrement: (framework: string) => {
        const start = performance.now();
        this.state.count--;
        this.state.lastUpdated = Date.now();
        this.state.framework = framework;
        this.functionCallCount++;
        
        const end = performance.now();
        this.executionTimes.push(end - start);
        
        console.log(`📉 [${framework}] Count decremented to ${this.state.count}`);
        return this.state.count;
      },

      reset: (framework: string) => {
        const start = performance.now();
        this.state.count = 0;
        this.state.lastUpdated = Date.now();
        this.state.framework = framework;
        this.functionCallCount++;
        
        const end = performance.now();
        this.executionTimes.push(end - start);
        
        console.log(`🔄 [${framework}] Count reset to 0`);
        return this.state.count;
      },

      getState: () => {
        return { ...this.state };
      },

      setState: (newState: MockWASMState) => {
        this.state = { ...newState };
        console.log(`💾 State updated:`, this.state);
      },

      memory: this.memory
    };
  }

  getMetrics() {
    const avgExecutionTime = this.executionTimes.length > 0 
      ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length 
      : 0;

    return {
      memoryUsage: {
        used: Math.random() * 1024 * 1024, // 더미 메모리 사용량 (1MB 내)
        allocated: this.memory.buffer.byteLength
      },
      functionCalls: this.functionCallCount,
      executionTime: Math.round(avgExecutionTime * 100) / 100 // 소수점 2자리
    };
  }
}

// 전역 Mock WASM 인스턴스
let globalMockWASM: MockWASMModule | null = null;

/**
 * Mock WebAssembly.instantiate
 * 실제 WASM 파일 대신 Mock 모듈을 반환
 */
const originalInstantiate = WebAssembly.instantiate;

WebAssembly.instantiate = async function(
  bytes: BufferSource | WebAssembly.Module,
  importObject?: WebAssembly.Imports
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  
  // 만약 실제 WASM 바이트코드가 있다면 원래 함수 사용
  if (bytes instanceof ArrayBuffer && bytes.byteLength > 1000) {
    try {
      return await originalInstantiate(bytes, importObject);
    } catch (error) {
      console.warn('⚠️ 실제 WASM 로드 실패, Mock으로 대체:', error);
    }
  }

  // Mock WASM 모듈 반환
  if (!globalMockWASM) {
    globalMockWASM = new MockWASMModule();
  }

  const exports = globalMockWASM.getExports();

  // WebAssembly.Instance 형태로 래핑
  const instance = {
    exports: exports as any
  } as WebAssembly.Instance;

  const module = {} as WebAssembly.Module;

  return {
    instance,
    module
  };
};

/**
 * Mock fetch for WASM files
 * /wasm/*.wasm 요청을 가로채서 더미 응답 반환
 */
const originalFetch = window.fetch;

window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  
  // WASM 파일 요청 감지
  if (url.includes('.wasm')) {
    console.log('🎭 Mock WASM 파일 응답:', url);
    
    // 더미 WASM 바이트코드 생성 (매우 작은 유효한 WASM 헤더)
    const dummyWASM = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // WASM magic number
      0x01, 0x00, 0x00, 0x00  // WASM version
    ]);

    return new Response(dummyWASM, {
      ok: true,
      status: 200,
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Length': dummyWASM.length.toString()
      }
    });
  }

  // 다른 요청은 원래 fetch 사용
  return originalFetch(input, init);
};

/**
 * WASM 기능 확인 및 초기화
 */
export function initWASMPolyfill() {
  console.log('🚀 WASM 폴리필 초기화');
  
  // WebAssembly 지원 확인
  if (typeof WebAssembly === 'undefined') {
    console.error('❌ WebAssembly가 지원되지 않는 브라우저입니다.');
    return false;
  }

  console.log('✅ WebAssembly 지원 확인');
  console.log('✅ Mock WASM 시스템 준비 완료');
  
  return true;
}

/**
 * Mock WASM 인스턴스 접근자
 */
export function getMockWASMInstance(): MockWASMModule | null {
  return globalMockWASM;
}

/**
 * 디버깅을 위한 상태 로깅
 */
export function logWASMState() {
  if (globalMockWASM) {
    const state = globalMockWASM.getExports().getState();
    const metrics = globalMockWASM.getMetrics();
    
    console.group('📊 WASM 상태 정보');
    console.log('State:', state);
    console.log('Metrics:', metrics);
    console.groupEnd();
  }
}

// 자동 초기화
initWASMPolyfill();

// 전역에 디버깅 함수 노출
(window as any).logWASMState = logWASMState;
(window as any).getMockWASMInstance = getMockWASMInstance; 