import type { ContainerInstance } from '@gaesup-state/core'
import type { FrameworkAdapter, ReactivitySystem, StateSubscription } from './types'

export function createFrameworkAdapter(
  reactivitySystem: ReactivitySystem
): FrameworkAdapter {
  const subscriptions = new Map<string, Set<StateSubscription>>()
  const stateCache = new Map<string, any>()

  return {
    // 상태 구독
    subscribe<T>(
      container: ContainerInstance,
      selector?: (state: any) => T,
      options?: { equalityFn?: (a: T, b: T) => boolean }
    ) {
      const containerId = container.id
      const { equalityFn = Object.is } = options || {}

      // 리액티브 값 생성
      const reactiveValue = reactivitySystem.createReactive<T>(
        selector ? selector(container.state) : container.state
      )

      // 구독 정보 저장
      const subscription: StateSubscription = {
        id: generateSubscriptionId(),
        container,
        selector,
        reactiveValue,
        unsubscribe: () => {}
      }

      // 컨테이너 상태 변경 구독
      const unsubscribe = container.subscribe((newState) => {
        const newValue = selector ? selector(newState) : newState
        const oldValue = reactiveValue.value

        if (!equalityFn(oldValue, newValue)) {
          reactivitySystem.updateReactive(reactiveValue, newValue)
          stateCache.set(containerId, newState)
        }
      })

      subscription.unsubscribe = unsubscribe

      // 구독 목록에 추가
      if (!subscriptions.has(containerId)) {
        subscriptions.set(containerId, new Set())
      }
      subscriptions.get(containerId)!.add(subscription)

      return {
        value: reactiveValue,
        unsubscribe: () => {
          unsubscribe()
          subscriptions.get(containerId)?.delete(subscription)
        }
      }
    },

    // 상태 업데이트
    async setState<T>(
      container: ContainerInstance,
      updater: T | ((prev: T) => T)
    ) {
      const currentState = container.state
      const newState = typeof updater === 'function' 
        ? (updater as (prev: T) => T)(currentState)
        : updater

      await container.updateState(newState)
      stateCache.set(container.id, newState)
    },

    // 함수 호출
    async callFunction<R>(
      container: ContainerInstance,
      functionName: string,
      args?: any
    ): Promise<R> {
      return await container.call<R>(functionName, args)
    },

    // 메트릭 조회
    getMetrics(container: ContainerInstance) {
      return container.metrics
    },

    // 정리
    cleanup() {
      subscriptions.forEach((subs) => {
        subs.forEach(sub => sub.unsubscribe())
      })
      subscriptions.clear()
      stateCache.clear()
    },

    // 캐시된 상태 조회
    getCachedState(containerId: string) {
      return stateCache.get(containerId)
    },

    // 활성 구독 수
    getSubscriptionCount(containerId: string) {
      return subscriptions.get(containerId)?.size || 0
    }
  }
}

// 고유 구독 ID 생성
function generateSubscriptionId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// React 어댑터
export function createReactAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive<T>(initialValue: T) {
      // React의 useState와 유사한 구조
      let value = initialValue
      const listeners = new Set<() => void>()
      
      return {
        get value() { return value },
        set value(newValue: T) {
          value = newValue
          listeners.forEach(listener => listener())
        },
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    },
    
    updateReactive<T>(reactive, newValue: T) {
      reactive.value = newValue
    }
  })
}

// Vue 어댑터
export function createVueAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive<T>(initialValue: T) {
      // Vue의 ref와 유사한 구조
      let value = initialValue
      const listeners = new Set<() => void>()
      
      return {
        get value() { return value },
        set value(newValue: T) {
          value = newValue
          listeners.forEach(listener => listener())
        },
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    },
    
    updateReactive<T>(reactive, newValue: T) {
      reactive.value = newValue
    }
  })
}

// Svelte 어댑터  
export function createSvelteAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive<T>(initialValue: T) {
      // Svelte의 writable store와 유사한 구조
      let value = initialValue
      const listeners = new Set<(value: T) => void>()
      
      return {
        get value() { return value },
        set value(newValue: T) {
          value = newValue
          listeners.forEach(listener => listener(newValue))
        },
        subscribe(listener: () => void) {
          listeners.add(listener as any)
          return () => listeners.delete(listener as any)
        }
      }
    },
    
    updateReactive<T>(reactive, newValue: T) {
      reactive.value = newValue
    }
  })
}

// Angular 어댑터
export function createAngularAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive<T>(initialValue: T) {
      // Angular의 signal과 유사한 구조
      let value = initialValue
      const listeners = new Set<() => void>()
      
      return {
        get value() { return value },
        set value(newValue: T) {
          value = newValue
          listeners.forEach(listener => listener())
        },
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    },
    
    updateReactive<T>(reactive, newValue: T) {
      reactive.value = newValue
    }
  })
} 