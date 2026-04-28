import type { AdapterContainerInstance, Unsubscribe, UniversalContainerInterface } from './types'

export class UniversalContainer<TState = unknown, TMetrics = unknown>
  implements UniversalContainerInterface<TState, TMetrics> {
  private currentState: TState
  private readonly listeners = new Set<(state: TState) => void>()

  constructor(
    readonly id: string,
    initialState: TState,
    readonly metrics: TMetrics,
    private readonly callHandler: (functionName: string, args?: unknown) => Promise<unknown> = async () => undefined
  ) {
    this.currentState = initialState
  }

  get state() {
    return this.currentState
  }

  subscribe(callback: (state: TState) => void): Unsubscribe {
    this.listeners.add(callback)
    callback(this.currentState)
    return () => {
      this.listeners.delete(callback)
    }
  }

  async updateState(state: TState) {
    this.currentState = state
    this.listeners.forEach((listener) => listener(this.currentState))
  }

  async setState(updater: TState | ((previous: TState) => TState)) {
    const next = typeof updater === 'function'
      ? (updater as (previous: TState) => TState)(this.currentState)
      : updater
    await this.updateState(next)
    return next
  }

  async call<TResult = unknown>(functionName: string, args?: unknown) {
    return this.callHandler(functionName, args) as Promise<TResult>
  }
}

export function createUniversalContainer<TState = unknown, TMetrics = unknown>(
  id: string,
  initialState: TState,
  metrics = {} as TMetrics,
  callHandler?: (functionName: string, args?: unknown) => Promise<unknown>
): AdapterContainerInstance<TState, TMetrics> {
  return new UniversalContainer(id, initialState, metrics, callHandler)
}
