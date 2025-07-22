import { GaesupCore } from '../index';

// Middleware 타입 정의
export type Middleware = (store: MiddlewareAPI) => (next: Dispatch) => (action: Action) => any;

export interface MiddlewareAPI {
  getState: () => any;
  dispatch: Dispatch;
}

export interface Action {
  type: string;
  payload?: any;
  meta?: any;
}

export type Dispatch = (action: Action) => any;

// Redux 스타일 미들웨어 지원
export class MiddlewareManager {
  private middlewares: Map<string, Middleware[]> = new Map();
  
  // 미들웨어 등록
  applyMiddleware(storeId: string, ...middlewares: Middleware[]): void {
    this.middlewares.set(storeId, middlewares);
  }
  
  // 미들웨어 체인 생성
  createDispatchChain(storeId: string, originalDispatch: Dispatch): Dispatch {
    const middlewares = this.middlewares.get(storeId) || [];
    
    if (middlewares.length === 0) {
      return originalDispatch;
    }
    
    const api: MiddlewareAPI = {
      getState: () => GaesupCore.select(storeId, ''),
      dispatch: (action: Action) => this.enhancedDispatch(storeId, action)
    };
    
    const chain = middlewares.map(middleware => middleware(api));
    return compose(...chain)(originalDispatch);
  }
  
  // 향상된 dispatch (미들웨어 적용)
  private enhancedDispatch(storeId: string, action: Action): any {
    return GaesupCore.dispatch(storeId, action.type, action.payload);
  }
}

// 유틸리티: compose
function compose(...funcs: Function[]): Function {
  if (funcs.length === 0) {
    return (arg: any) => arg;
  }
  
  if (funcs.length === 1) {
    return funcs[0];
  }
  
  return funcs.reduce((a, b) => (...args: any[]) => a(b(...args)));
}

// 내장 미들웨어들

// 1. Logger 미들웨어
export const logger: Middleware = (store) => (next) => (action) => {
  console.group(`Action: ${action.type}`);
  console.log('Previous State:', store.getState());
  console.log('Action:', action);
  
  const result = next(action);
  
  console.log('Next State:', store.getState());
  console.groupEnd();
  
  return result;
};

// 2. Thunk 미들웨어 (비동기 액션)
export const thunk: Middleware = (store) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(store.dispatch, store.getState);
  }
  
  return next(action);
};

// 3. DevTools 미들웨어
export const devTools: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  
  if (typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__) {
    const devtools = (window as any).__REDUX_DEVTOOLS_EXTENSION__.connect();
    devtools.send(action.type, store.getState());
  }
  
  return result;
};

// 4. Crash Reporter 미들웨어
export const crashReporter: Middleware = (store) => (next) => (action) => {
  try {
    return next(action);
  } catch (err) {
    console.error('Caught an exception!', err);
    console.error('Action:', action);
    console.error('State:', store.getState());
    
    // 에러 리포팅 서비스로 전송
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(err, {
        extra: {
          action,
          state: store.getState()
        }
      });
    }
    
    throw err;
  }
};

// 5. 액션 타이밍 미들웨어
export const timing: Middleware = (store) => (next) => (action) => {
  const start = performance.now();
  const result = next(action);
  const end = performance.now();
  
  console.log(`Action ${action.type} took ${(end - start).toFixed(2)}ms`);
  
  return result;
};

// 6. 액션 검증 미들웨어
export const validator = (schema: any): Middleware => (store) => (next) => (action) => {
  if (schema[action.type]) {
    const validation = schema[action.type](action.payload);
    if (!validation.valid) {
      console.error(`Invalid action payload for ${action.type}:`, validation.errors);
      return;
    }
  }
  
  return next(action);
};

// 7. 로컬 스토리지 동기화 미들웨어
export const localStorage = (key: string): Middleware => (store) => (next) => (action) => {
  const result = next(action);
  
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, JSON.stringify(store.getState()));
  }
  
  return result;
};

// 8. 액션 버퍼링 미들웨어 (배치 처리)
export const buffer = (delay: number = 100): Middleware => {
  let buffer: Action[] = [];
  let timeoutId: any = null;
  
  return (store) => (next) => (action) => {
    buffer.push(action);
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      const actions = buffer;
      buffer = [];
      
      console.log(`Flushing ${actions.length} buffered actions`);
      actions.forEach(a => next(a));
    }, delay);
  };
};

// 9. 액션 중복 방지 미들웨어
export const dedupe = (wait: number = 100): Middleware => {
  const pending = new Map<string, any>();
  
  return (store) => (next) => (action) => {
    const key = JSON.stringify(action);
    
    if (pending.has(key)) {
      clearTimeout(pending.get(key));
    }
    
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      next(action);
    }, wait));
  };
};

// 10. 조건부 액션 미들웨어
export const conditional: Middleware = (store) => (next) => (action) => {
  if (action.meta?.condition) {
    const state = store.getState();
    const shouldDispatch = action.meta.condition(state);
    
    if (!shouldDispatch) {
      console.log(`Action ${action.type} skipped due to condition`);
      return;
    }
  }
  
  return next(action);
};

// 전역 미들웨어 매니저
export const middlewareManager = new MiddlewareManager(); 