import { createReactiveValue } from './reactive'
import type { EqualityFn, SignalValue } from './types'

export function createSignal<T>(
  initialValue: T,
  equalityFn: EqualityFn<T> = Object.is
): SignalValue<T> {
  const signal = createReactiveValue(initialValue, equalityFn) as SignalValue<T>

  signal.update = (updater: (previous: T) => T) => {
    const next = updater(signal.value)
    signal.set(next)
    return signal.value
  }

  return signal
}

export const createSignalValue = createSignal
