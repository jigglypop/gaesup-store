import type { ReactiveValue, ReactivityBridge, SyncChannel, Unsubscribe } from './types'

export function createSyncChannel<T>(name: string): SyncChannel<T> {
  const listeners = new Set<(value: T) => void>()

  return {
    name,
    publish(value: T) {
      listeners.forEach((listener) => listener(value))
    },
    subscribe(listener: (value: T) => void): Unsubscribe {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      listeners.clear()
    }
  }
}

export function createReactivityBridge<TSource, TTarget = TSource>(
  source: ReactiveValue<TSource>,
  target: ReactiveValue<TTarget>,
  map: (value: TSource) => TTarget = ((value) => value as unknown as TTarget)
): ReactivityBridge<TSource, TTarget> {
  const unsubscribe = source.subscribe((value) => {
    target.set(map(value))
  })

  return {
    source,
    target,
    unsubscribe
  }
}

export class StateSynchronizer<T> {
  private readonly channels = new Set<SyncChannel<T>>()

  addChannel(channel: SyncChannel<T>) {
    this.channels.add(channel)
    return () => {
      this.channels.delete(channel)
    }
  }

  publish(value: T) {
    this.channels.forEach((channel) => channel.publish(value))
  }

  close() {
    this.channels.forEach((channel) => channel.close())
    this.channels.clear()
  }
}
