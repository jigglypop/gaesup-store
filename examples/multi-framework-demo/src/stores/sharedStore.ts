// Gaesup-State를 사용한 공유 스토어
import { GaesupCore } from 'gaesup-state';

// 공유 상태 타입 정의
export interface SharedState {
  count: number;
  lastUpdated: number | null;
  framework: string;
  history: Array<{
    action: string;
    framework: string;
    timestamp: number;
    previousValue: number;
    newValue: number;
  }>;
}

// 초기 상태
const initialState: SharedState = {
  count: 0,
  lastUpdated: null,
  framework: 'None',
  history: []
};

// 공유 스토어 ID
export const SHARED_STORE_ID = 'multi-framework-demo';

// 스토어 초기화
export async function initializeSharedStore(): Promise<void> {
  try {
    await GaesupCore.createStore(SHARED_STORE_ID, initialState);
    console.log('Shared store initialized');
  } catch (error) {
    // 이미 존재하는 경우 무시
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) {
      throw error;
    }
  }
}

// 액션 타입
export const ActionTypes = {
  INCREMENT: 'INCREMENT',
  DECREMENT: 'DECREMENT',
  RESET: 'RESET',
  UPDATE_FRAMEWORK: 'UPDATE_FRAMEWORK',
  ADD_HISTORY: 'ADD_HISTORY'
} as const;

// 헬퍼 함수들
export async function incrementCount(framework: string): Promise<number> {
  const nextState = await GaesupCore.dispatchCounter(SHARED_STORE_ID, 1, framework, 'INCREMENT') as SharedState;
  return nextState.count;
}

export async function incrementCountBatch(framework: string, count: number): Promise<number> {
  const nextState = await GaesupCore.dispatchCounterBatch(SHARED_STORE_ID, 1, count, framework, 'INCREMENT') as SharedState;
  return nextState.count;
}

export async function decrementCount(framework: string): Promise<number> {
  const nextState = await GaesupCore.dispatchCounter(SHARED_STORE_ID, -1, framework, 'DECREMENT') as SharedState;
  return nextState.count;
}

export async function resetCount(framework: string): Promise<number> {
  const currentState = GaesupCore.select(SHARED_STORE_ID, '') as SharedState;
  const previousValue = currentState.count;
  const newValue = 0;
  
  // 히스토리 추가
  const historyEntry = {
    action: 'RESET',
    framework,
    timestamp: Date.now(),
    previousValue,
    newValue
  };
  
  // 상태 업데이트
  await GaesupCore.dispatch(SHARED_STORE_ID, 'MERGE', {
    count: newValue,
    lastUpdated: Date.now(),
    framework,
    history: [...currentState.history, historyEntry].slice(-10)
  });
  
  return newValue;
}

// 현재 상태 가져오기
export function getSharedState(): SharedState {
  return GaesupCore.select(SHARED_STORE_ID, '') as SharedState;
}

// 특정 필드만 가져오기
export function getCount(): number {
  return GaesupCore.select(SHARED_STORE_ID, 'count') as number;
}

export function getLastUpdated(): number | null {
  return GaesupCore.select(SHARED_STORE_ID, 'lastUpdated') as number | null;
}

export function getHistory(): SharedState['history'] {
  return GaesupCore.select(SHARED_STORE_ID, 'history') as SharedState['history'];
}

// 상태 변경 리스너 등록
export function subscribeToStore(callback: (state: SharedState) => void): () => void {
  const callbackId = `shared_${Math.random().toString(36).slice(2)}`;
  
  GaesupCore.registerCallback(callbackId, (state?: SharedState) => {
    callback(state || getSharedState());
  });
  
  const subscriptionId = GaesupCore.subscribe(SHARED_STORE_ID, '', callbackId);
  
  // 언서브스크라이브 함수 반환
  return () => {
    GaesupCore.unsubscribe(subscriptionId);
    GaesupCore.unregisterCallback(callbackId);
  };
}

// 메트릭스 가져오기
export async function getStoreMetrics() {
  return await GaesupCore.getMetrics(SHARED_STORE_ID);
}

// DevTools 연동
export function connectDevTools() {
  if (typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__) {
    const devtools = (window as any).__REDUX_DEVTOOLS_EXTENSION__.connect({
      name: 'Gaesup Multi-Framework Demo'
    });

    // 초기 상태 전송
    devtools.init(getSharedState());

    // 상태 변경 감지
    subscribeToStore((state) => {
      devtools.send('STATE_UPDATE', state);
    });

    console.log('Redux DevTools connected');
  }
}

// 스냅샷 기능
export async function createStateSnapshot(): Promise<string> {
  return await GaesupCore.createSnapshot(SHARED_STORE_ID);
}

export async function restoreStateSnapshot(snapshotId: string): Promise<void> {
  await GaesupCore.restoreSnapshot(SHARED_STORE_ID, snapshotId);
} 
