import type { EqualityFn, ReactiveValue, StoreState, Unsubscribe } from './types'

export function createReactiveValue<T>(
  initialValue: T,
  equalityFn: EqualityFn<T> = Object.is
): ReactiveValue<T> {
  let current = initialValue
  const listeners = new Set<(value: T) => void>()

  const api: ReactiveValue<T> = {
    get value() {
      return current
    },
    get() {
      return current
    },
    set(next: T) {
      if (equalityFn(current, next)) return
      current = next
      listeners.forEach((listener) => listener(current))
    },
    subscribe(listener: (value: T) => void): Unsubscribe {
      listeners.add(listener)
      listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    destroy() {
      listeners.clear()
    }
  }

  return api
}

export const createReactiveState = createReactiveValue

export function createStore<T extends Record<string, unknown>>(
  initialState: T,
  equalityFn: EqualityFn<T> = Object.is
): StoreState<T> {
  const state = createReactiveValue(initialState, equalityFn)

  return {
    ...state,
    patch(patch: Partial<T>) {
      const next = { ...state.value, ...patch } as T
      state.set(next)
      return next
    },
    select<TValue>(selector: (state: T) => TValue) {
      const selected = createReactiveValue(selector(state.value))
      return bridgeSelection(state, selected, selector)
    }
  }
}

function bridgeSelection<T extends Record<string, unknown>, TValue>(
  source: ReactiveValue<T>,
  selected: ReactiveValue<TValue>,
  selector: (state: T) => TValue
) {
  const stop = source.subscribe((state) => {
    selected.set(selector(state))
  })
  const originalDestroy = selected.destroy
  selected.destroy = () => {
    stop()
    originalDestroy()
  }
  return selected
}
