import type { Unsubscribe } from '../types'

export type EventCallback = (data: any) => void

export class EventBus {
  private readonly listeners: Map<string, Set<EventCallback>> = new Map()
  private readonly onceListeners: Map<string, Set<EventCallback>> = new Map()
  private readonly debugMode: boolean

  constructor(debugMode = false) {
    this.debugMode = debugMode
  }

  emit(event: string, data: any): void {
    const timestamp = new Date()
    
    if (this.debugMode) {
      console.debug(`[EventBus] Emitting event: ${event}`, { data, timestamp })
    }

    // 일반 리스너들
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[EventBus] Error in listener for event ${event}:`, error)
        }
      })
    }

    // 일회성 리스너들
    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      onceListeners.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[EventBus] Error in once listener for event ${event}:`, error)
        }
      })
      // 일회성 리스너들 제거
      this.onceListeners.delete(event)
    }
  }

  on(event: string, callback: EventCallback): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    
    const listeners = this.listeners.get(event)!
    listeners.add(callback)

    if (this.debugMode) {
      console.debug(`[EventBus] Added listener for event: ${event} (total: ${listeners.size})`)
    }

    // unsubscribe 함수 반환
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) {
        this.listeners.delete(event)
      }
      
      if (this.debugMode) {
        console.debug(`[EventBus] Removed listener for event: ${event}`)
      }
    }
  }

  once(event: string, callback: EventCallback): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set())
    }
    
    const onceListeners = this.onceListeners.get(event)!
    onceListeners.add(callback)

    if (this.debugMode) {
      console.debug(`[EventBus] Added once listener for event: ${event}`)
    }
  }

  off(event: string, callback: EventCallback): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.delete(callback)
      if (listeners.size === 0) {
        this.listeners.delete(event)
      }
    }

    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      onceListeners.delete(callback)
      if (onceListeners.size === 0) {
        this.onceListeners.delete(event)
      }
    }

    if (this.debugMode) {
      console.debug(`[EventBus] Removed listener for event: ${event}`)
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event)
      this.onceListeners.delete(event)
      
      if (this.debugMode) {
        console.debug(`[EventBus] Removed all listeners for event: ${event}`)
      }
    } else {
      const totalListeners = Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0)
      const totalOnceListeners = Array.from(this.onceListeners.values()).reduce((sum, set) => sum + set.size, 0)
      
      this.listeners.clear()
      this.onceListeners.clear()
      
      if (this.debugMode) {
        console.debug(`[EventBus] Removed all listeners (${totalListeners + totalOnceListeners} total)`)
      }
    }
  }

  listenerCount(event: string): number {
    const listeners = this.listeners.get(event)?.size || 0
    const onceListeners = this.onceListeners.get(event)?.size || 0
    return listeners + onceListeners
  }

  eventNames(): string[] {
    const events = new Set([
      ...this.listeners.keys(),
      ...this.onceListeners.keys()
    ])
    return Array.from(events)
  }

  // 비동기 이벤트 발행
  async emitAsync(event: string, data: any): Promise<void> {
    const promises: Promise<void>[] = []

    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach(callback => {
        promises.push(
          Promise.resolve().then(() => callback(data)).catch(error => {
            console.error(`[EventBus] Error in async listener for event ${event}:`, error)
          })
        )
      })
    }

    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      onceListeners.forEach(callback => {
        promises.push(
          Promise.resolve().then(() => callback(data)).catch(error => {
            console.error(`[EventBus] Error in async once listener for event ${event}:`, error)
          })
        )
      })
      this.onceListeners.delete(event)
    }

    await Promise.all(promises)
  }

  // 네임스페이스 지원
  createNamespace(namespace: string): EventBus {
    const namespacedBus = new EventBus(this.debugMode)
    
    // 네임스페이스가 있는 이벤트로 변환
    const originalEmit = namespacedBus.emit.bind(namespacedBus)
    const originalOn = namespacedBus.on.bind(namespacedBus)
    const originalOnce = namespacedBus.once.bind(namespacedBus)
    const originalOff = namespacedBus.off.bind(namespacedBus)

    namespacedBus.emit = (event: string, data: any) => {
      this.emit(`${namespace}:${event}`, data)
    }

    namespacedBus.on = (event: string, callback: EventCallback) => {
      return this.on(`${namespace}:${event}`, callback)
    }

    namespacedBus.once = (event: string, callback: EventCallback) => {
      this.once(`${namespace}:${event}`, callback)
    }

    namespacedBus.off = (event: string, callback: EventCallback) => {
      this.off(`${namespace}:${event}`, callback)
    }

    return namespacedBus
  }
} 