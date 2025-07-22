import { Injectable, signal, computed, effect, DestroyRef, inject } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { BehaviorSubject, Observable, from, EMPTY } from 'rxjs'
import { catchError, switchMap, retry, delay } from 'rxjs/operators'
import type { ContainerInstance, ContainerConfig } from '@gaesup-state/core'
import { ContainerManagerService } from './container-manager.service'
import type { ContainerServiceConfig } from '../types'

@Injectable()
export class ContainerService<T = any> {
  private readonly destroyRef = inject(DestroyRef)
  private readonly containerManager = inject(ContainerManagerService)

  // Signals for reactive state
  private readonly _state = signal<T | undefined>(undefined)
  private readonly _isLoading = signal(false)
  private readonly _error = signal<Error | null>(null)
  private readonly _container = signal<ContainerInstance | null>(null)

  // Public signals (readonly)
  readonly state = this._state.asReadonly()
  readonly isLoading = this._isLoading.asReadonly()
  readonly error = this._error.asReadonly()
  readonly container = this._container.asReadonly()

  // Computed signals
  readonly isConnected = computed(() => this._container() !== null)
  readonly hasError = computed(() => this._error() !== null)
  readonly metrics = computed(() => this._container()?.metrics)

  // Observables for reactive streams
  private readonly stateSubject = new BehaviorSubject<T | undefined>(undefined)
  readonly state$ = this.stateSubject.asObservable()

  private containerName: string = ''
  private config: ContainerServiceConfig<T> = {}
  private unsubscribeContainer?: () => void
  private retryCount = 0

  constructor() {
    // Sync signals with observables
    effect(() => {
      this.stateSubject.next(this._state())
    })
  }

  // Initialize container
  initialize(containerName: string, config: ContainerServiceConfig<T> = {}) {
    this.containerName = containerName
    this.config = {
      autoStart: true,
      retryCount: 3,
      retryDelay: 1000,
      ...config
    }

    if (config.initialState !== undefined) {
      this._state.set(config.initialState)
    }

    if (this.config.autoStart) {
      this.start()
    }

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      this.cleanup()
    })
  }

  // Start container
  async start(): Promise<void> {
    if (this._isLoading()) return

    this._isLoading.set(true)
    this._error.set(null)

    try {
      const manager = await this.containerManager.getManager()
      const containerInstance = await manager.run(
        this.containerName, 
        this.config.containerConfig || {}
      )

      this._container.set(containerInstance)

      // Set initial state
      if (this.config.initialState !== undefined) {
        await containerInstance.updateState(this.config.initialState)
      }

      // Subscribe to state changes
      this.unsubscribeContainer = containerInstance.subscribe((newState) => {
        this._state.set(newState)
        this.config.onStateChange?.(newState)
      })

      this.retryCount = 0

    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error('Container startup failed')
      this._error.set(errorInstance)
      this.config.onError?.(errorInstance)

      // Retry logic
      if (this.retryCount < (this.config.retryCount || 3)) {
        this.retryCount++
        setTimeout(() => {
          this.start()
        }, (this.config.retryDelay || 1000) * this.retryCount)
      }
    } finally {
      this._isLoading.set(false)
    }
  }

  // Stop container
  async stop(): Promise<void> {
    const container = this._container()
    if (container) {
      try {
        if (this.unsubscribeContainer) {
          this.unsubscribeContainer()
          this.unsubscribeContainer = undefined
        }

        await container.stop()
        this._container.set(null)
        this._state.set(this.config.initialState)
      } catch (error) {
        console.error('Failed to stop container:', error)
      }
    }
  }

  // Call function in container
  async call<R = any>(functionName: string, args?: any): Promise<R> {
    const container = this._container()
    if (!container) {
      throw new Error('Container not available')
    }

    try {
      return await container.call<R>(functionName, args)
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error('Function call failed')
      this._error.set(errorInstance)
      this.config.onError?.(errorInstance)
      throw errorInstance
    }
  }

  // Update state
  async setState(newState: T | ((prev: T) => T)): Promise<void> {
    const container = this._container()
    if (!container) {
      throw new Error('Container not available')
    }

    try {
      const currentState = this._state()
      const resolvedState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(currentState!)
        : newState

      await container.updateState(resolvedState)
      this._state.set(resolvedState)
      this.config.onStateChange?.(resolvedState)
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error('State update failed')
      this._error.set(errorInstance)
      this.config.onError?.(errorInstance)
      throw errorInstance
    }
  }

  // Restart container
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  // Refresh state
  async refresh(): Promise<void> {
    const container = this._container()
    if (container) {
      try {
        const currentState = container.state
        this._state.set(currentState)
        this.config.onStateChange?.(currentState)
      } catch (error) {
        const errorInstance = error instanceof Error ? error : new Error('Refresh failed')
        this._error.set(errorInstance)
        this.config.onError?.(errorInstance)
      }
    }
  }

  // Observable methods for RxJS integration
  call$<R = any>(functionName: string, args?: any): Observable<R> {
    return from(this.call<R>(functionName, args)).pipe(
      catchError(error => {
        console.error('Function call error:', error)
        return EMPTY
      })
    )
  }

  setState$(newState: T | ((prev: T) => T)): Observable<void> {
    return from(this.setState(newState)).pipe(
      catchError(error => {
        console.error('State update error:', error)
        return EMPTY
      })
    )
  }

  // Private cleanup
  private cleanup(): void {
    if (this.unsubscribeContainer) {
      this.unsubscribeContainer()
    }
    const container = this._container()
    if (container) {
      container.stop().catch(console.error)
    }
  }
} 