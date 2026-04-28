import { createReactiveValue } from './reactive'
import type {
  AdapterContainerInstance,
  FrameworkAdapter,
  ReactiveValue,
  ReactivitySystem,
  StateSubscription,
  SubscribeOptions
} from './types'

export function createFrameworkAdapter(
  reactivitySystem: ReactivitySystem
): FrameworkAdapter {
  const subscriptions = new Map<string, Set<{ unsubscribe: () => void }>>()
  const stateCache = new Map<string, unknown>()

  return {
    subscribe<TState, TValue = TState>(
      container: AdapterContainerInstance<TState>,
      selector?: (state: TState) => TValue,
      options?: SubscribeOptions<TValue>
    ) {
      const containerId = container.id
      const { equalityFn = Object.is, emitInitial = true } = options || {}
      const selectValue = (state: TState) => selector ? selector(state) : state as unknown as TValue

      const reactiveValue = reactivitySystem.createReactive<TValue>(
        selectValue(container.state)
      )

      const subscription: StateSubscription<TState, TValue> = {
        id: generateSubscriptionId(),
        container,
        reactiveValue,
        unsubscribe: () => {}
      }

      if (selector) {
        subscription.selector = selector
      }

      const unsubscribe = container.subscribe((newState) => {
        const newValue = selectValue(newState)
        const oldValue = reactiveValue.value

        if (!equalityFn(oldValue, newValue)) {
          reactivitySystem.updateReactive(reactiveValue, newValue)
          stateCache.set(containerId, newState)
        }
      })

      subscription.unsubscribe = unsubscribe

      if (!subscriptions.has(containerId)) {
        subscriptions.set(containerId, new Set())
      }
      subscriptions.get(containerId)!.add(subscription)

      if (!emitInitial) {
        stateCache.set(containerId, container.state)
      }

      return {
        value: reactiveValue,
        unsubscribe: () => {
          unsubscribe()
          subscriptions.get(containerId)?.delete(subscription)
        }
      }
    },

    async setState<TState>(
      container: AdapterContainerInstance<TState>,
      updater: TState | ((previous: TState) => TState)
    ) {
      const currentState = container.state
      const newState = typeof updater === 'function'
        ? (updater as (previous: TState) => TState)(currentState)
        : updater

      await container.updateState(newState)
      stateCache.set(container.id, newState)
      return newState
    },

    async patchState<TState extends Record<string, unknown>>(
      container: AdapterContainerInstance<TState>,
      patch: Partial<TState>
    ) {
      const next = { ...container.state, ...patch } as TState
      await container.updateState(next)
      stateCache.set(container.id, next)
      return next
    },

    async callFunction<TResult>(
      container: AdapterContainerInstance,
      functionName: string,
      args?: unknown
    ): Promise<TResult> {
      return container.call<TResult>(functionName, args)
    },

    getMetrics<TMetrics>(container: AdapterContainerInstance<unknown, TMetrics>) {
      return container.metrics
    },

    cleanup() {
      subscriptions.forEach((subs) => {
        subs.forEach(sub => sub.unsubscribe())
      })
      subscriptions.clear()
      stateCache.clear()
    },

    getCachedState<TState = unknown>(containerId: string) {
      return stateCache.get(containerId) as TState | undefined
    },

    getSubscriptionCount(containerId: string) {
      return subscriptions.get(containerId)?.size || 0
    }
  }
}

function generateSubscriptionId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export function createReactAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive: createReactiveValue,
    updateReactive<T>(reactive: ReactiveValue<T>, newValue: T) {
      reactive.set(newValue)
    }
  })
}

export function createVueAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive: createReactiveValue,
    updateReactive<T>(reactive: ReactiveValue<T>, newValue: T) {
      reactive.set(newValue)
    }
  })
}

export function createSvelteAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive: createReactiveValue,
    updateReactive<T>(reactive: ReactiveValue<T>, newValue: T) {
      reactive.set(newValue)
    }
  })
}

export function createAngularAdapter(): FrameworkAdapter {
  return createFrameworkAdapter({
    createReactive: createReactiveValue,
    updateReactive<T>(reactive: ReactiveValue<T>, newValue: T) {
      reactive.set(newValue)
    }
  })
} 
