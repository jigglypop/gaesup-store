import { signal } from '@angular/core'

export function createContainerSignal<T>(initialValue?: T) {
  return signal<T | undefined>(initialValue)
}
