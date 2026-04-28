import { signal } from '@angular/core'

export function createContainerMetricsSignal<T>(initialValue?: T) {
  return signal<T | undefined>(initialValue)
}
