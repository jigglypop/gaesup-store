export interface AdapterContainerInstance {
  id: string
  state: any
  metrics: any
  subscribe(callback: (state: any) => void): () => void
  updateState(state: any): Promise<void>
  call<T = any>(functionName: string, args?: any): Promise<T>
}

export interface ReactiveValue<T = any> {
  value: T
  subscribe?(listener: () => void): () => void
}

export interface ReactivitySystem {
  createReactive<T>(initialValue: T): ReactiveValue<T>
  updateReactive<T>(reactive: ReactiveValue<T>, newValue: T): void
}

export interface StateSubscription {
  id: string
  container: AdapterContainerInstance
  selector?: (state: any) => any
  reactiveValue: ReactiveValue
  unsubscribe: () => void
}

export interface FrameworkAdapter {
  subscribe<T>(
    container: AdapterContainerInstance,
    selector?: (state: any) => T,
    options?: { equalityFn?: (a: T, b: T) => boolean }
  ): { value: ReactiveValue<T>; unsubscribe: () => void }
  setState<T>(container: AdapterContainerInstance, updater: T | ((prev: T) => T)): Promise<void>
  callFunction<R>(container: AdapterContainerInstance, functionName: string, args?: any): Promise<R>
  getMetrics(container: AdapterContainerInstance): any
  cleanup(): void
  getCachedState(containerId: string): any
  getSubscriptionCount(containerId: string): number
}
