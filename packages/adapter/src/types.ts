export type Unsubscribe = () => void
export type EqualityFn<T> = (previous: T, next: T) => boolean

export interface AdapterContainerInstance<TState = unknown, TMetrics = unknown> {
  id: string
  state: TState
  metrics: TMetrics
  subscribe(callback: (state: TState) => void): Unsubscribe
  updateState(state: TState): Promise<void>
  call<TResult = unknown>(functionName: string, args?: unknown): Promise<TResult>
}

export interface ReactiveValue<T = unknown> {
  readonly value: T
  get(): T
  set(value: T): void
  subscribe(listener: (value: T) => void): Unsubscribe
  destroy(): void
}

export interface ReactivitySystem {
  createReactive<T>(initialValue: T): ReactiveValue<T>
  updateReactive<T>(reactive: ReactiveValue<T>, newValue: T): void
}

export interface StateSubscription<TState = unknown, TValue = unknown> {
  id: string
  container: AdapterContainerInstance<TState>
  selector?: (state: TState) => TValue
  reactiveValue: ReactiveValue<TValue>
  unsubscribe: Unsubscribe
}

export interface AdapterSubscription<T> {
  value: ReactiveValue<T>
  unsubscribe: Unsubscribe
}

export interface SubscribeOptions<T> {
  equalityFn?: EqualityFn<T>
  emitInitial?: boolean
}

export interface FrameworkAdapter {
  subscribe<TState, TValue = TState>(
    container: AdapterContainerInstance<TState>,
    selector?: (state: TState) => TValue,
    options?: SubscribeOptions<TValue>
  ): AdapterSubscription<TValue>
  setState<TState>(
    container: AdapterContainerInstance<TState>,
    updater: TState | ((previous: TState) => TState)
  ): Promise<TState>
  patchState<TState extends Record<string, unknown>>(
    container: AdapterContainerInstance<TState>,
    patch: Partial<TState>
  ): Promise<TState>
  callFunction<TResult>(container: AdapterContainerInstance, functionName: string, args?: unknown): Promise<TResult>
  getMetrics<TMetrics>(container: AdapterContainerInstance<unknown, TMetrics>): TMetrics
  cleanup(): void
  getCachedState<TState = unknown>(containerId: string): TState | undefined
  getSubscriptionCount(containerId: string): number
}

export interface SignalValue<T = unknown> extends ReactiveValue<T> {
  update(updater: (previous: T) => T): T
}

export interface StoreState<T extends Record<string, unknown> = Record<string, unknown>> extends ReactiveValue<T> {
  patch(patch: Partial<T>): T
  select<TValue>(selector: (state: T) => TValue): ReactiveValue<TValue>
}

export interface SyncChannel<T = unknown> {
  name: string
  publish(value: T): void
  subscribe(listener: (value: T) => void): Unsubscribe
  close(): void
}

export interface ReactivityBridge<TSource = unknown, TTarget = TSource> {
  source: ReactiveValue<TSource>
  target: ReactiveValue<TTarget>
  unsubscribe: Unsubscribe
}

export interface UniversalContainerInterface<TState = unknown, TMetrics = unknown>
  extends AdapterContainerInstance<TState, TMetrics> {
  setState(updater: TState | ((previous: TState) => TState)): Promise<TState>
}
