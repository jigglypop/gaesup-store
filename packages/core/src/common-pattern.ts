/**
 * 🚀 Gaesup-State 통합 패턴
 * React, Vue, Svelte에서 동일하게 사용할 수 있는 범용 패턴
 */

import { GaesupCore } from './index'
import type { ContainerConfig } from './types'

// 공통 인터페이스 정의
export interface GaesupState<T = any> {
  data: T
  loading: boolean
  error: string | null
  timestamp: string
}

export interface GaesupStateActions {
  set: (newState: any) => Promise<void>
  merge: (partialState: any) => Promise<void>  
  update: (path: string, value: any) => Promise<void>
  reset: () => Promise<void>
  snapshot: () => string
  restore: (snapshotId: string) => Promise<void>
}

export interface GaesupStateManager<T = any> {
  state: GaesupState<T>
  actions: GaesupStateActions
  subscribe: (callback: (state: GaesupState<T>) => void) => () => void
  cleanup: () => void
}

/**
 * 🎯 핵심 통합 팩토리 함수
 * 모든 프레임워크에서 동일하게 사용
 */
export class UnifiedGaesupManager<T = any> implements GaesupStateManager<T> {
  private _state: GaesupState<T>
  private _subscribers: Set<(state: GaesupState<T>) => void> = new Set()
  private _initialized = false
  private _unsubscribe?: () => void

  constructor(private initialState: T, _config?: ContainerConfig) {
    this._state = {
      data: initialState,
      loading: false,
      error: null,
      timestamp: new Date().toISOString()
    }
  }

  // 지연 초기화
  private async _ensureInitialized() {
    if (this._initialized) return
    
    try {
      await GaesupCore.initStore(this.initialState)
      
      // Core 구독 설정
      this._unsubscribe = GaesupCore.subscribe((coreState: any) => {
        this._state = {
          data: coreState,
          loading: false,
          error: null,
          timestamp: new Date().toISOString()
        }
        this._notifySubscribers()
      })
      
      this._initialized = true
    } catch (error) {
      this._state.error = error instanceof Error ? error.message : String(error)
      this._state.loading = false
      this._notifySubscribers()
    }
  }

  private _notifySubscribers() {
    this._subscribers.forEach(callback => callback(this._state))
  }

  // 공개 API
  get state(): GaesupState<T> {
    return this._state
  }

  get actions(): GaesupStateActions {
    return {
      set: async (newState: any) => {
        await this._ensureInitialized()
        this._state.loading = true
        this._notifySubscribers()
        
        try {
          await GaesupCore.set(newState)
        } catch (error) {
          this._state.error = error instanceof Error ? error.message : String(error)
          this._state.loading = false
          this._notifySubscribers()
        }
      },

      merge: async (partialState: any) => {
        await this._ensureInitialized()
        this._state.loading = true
        this._notifySubscribers()
        
        try {
          await GaesupCore.merge(partialState)
        } catch (error) {
          this._state.error = error instanceof Error ? error.message : String(error)
          this._state.loading = false
          this._notifySubscribers()
        }
      },

      update: async (path: string, value: any) => {
        await this._ensureInitialized()
        this._state.loading = true
        this._notifySubscribers()
        
        try {
          await GaesupCore.update(path, value)
        } catch (error) {
          this._state.error = error instanceof Error ? error.message : String(error)
          this._state.loading = false
          this._notifySubscribers()
        }
      },

      reset: async () => {
        await this._ensureInitialized()
        await GaesupCore.set(this.initialState)
      },

      snapshot: () => {
        if (!this._initialized) throw new Error('Manager not initialized')
        return GaesupCore.createSnapshot()
      },

      restore: async (snapshotId: string) => {
        await this._ensureInitialized()
        await GaesupCore.restoreSnapshot(snapshotId)
      }
    }
  }

  subscribe(callback: (state: GaesupState<T>) => void): () => void {
    this._subscribers.add(callback)
    
    // 즉시 현재 상태 전달
    callback(this._state)
    
    // 초기화 시작 (비동기)
    this._ensureInitialized()
    
    return () => {
      this._subscribers.delete(callback)
    }
  }

  cleanup(): void {
    this._subscribers.clear()
    if (this._unsubscribe) {
      this._unsubscribe()
    }
    GaesupCore.cleanup()
  }
}

/**
 * 🏭 팩토리 함수 - 모든 프레임워크에서 동일하게 사용
 */
export function createGaesupManager<T = any>(
  initialState: T, 
  config?: ContainerConfig
): UnifiedGaesupManager<T> {
  return new UnifiedGaesupManager(initialState, config)
}

/**
 * 🎯 배치 업데이트 헬퍼
 */
export async function batchUpdate(updates: Array<{ path: string; value: any }>) {
  return GaesupCore.batch(updates)
}

/**
 * 📊 메트릭스 헬퍼
 */
export function getGaesupMetrics() {
  return GaesupCore.getMetrics()
}

/**
 * 🧪 개발자 도구 헬퍼
 */
export function enableDevTools() {
  if (typeof window !== 'undefined') {
    console.log('🔧 Gaesup-State DevTools enabled')
    return true
  }
  return false
} 