import type {
  AdapterContract,
  AdapterContractContainer,
  AdapterMountContext,
  AdapterSnapshot
} from './types'

export function createAdapterContract<TState = any>(): AdapterContract<TState> {
  const listeners = new Set<(snapshot: AdapterSnapshot<TState>) => void>()
  const errorListeners = new Set<(error: Error) => void>()
  let container: AdapterContractContainer<TState> | null = null
  let unsubscribeContainer: (() => void) | null = null
  let snapshot: AdapterSnapshot<TState> = {
    containerId: '',
    mounted: false,
    state: undefined,
    error: null
  }

  const emit = () => {
    listeners.forEach((listener) => listener(snapshot))
  }

  const fail = (error: unknown) => {
    const resolved = error instanceof Error ? error : new Error(String(error))
    snapshot = {
      ...snapshot,
      error: resolved
    }
    errorListeners.forEach((listener) => listener(resolved))
    emit()
    return resolved
  }

  const updateSnapshot = (next: Partial<AdapterSnapshot<TState>>) => {
    snapshot = {
      ...snapshot,
      ...next
    }
    emit()
    return snapshot
  }

  return {
    async mount(context: AdapterMountContext<TState>) {
      try {
        await this.unmount()
        return mountContainer(context.container, context.initialState, false)
      } catch (error) {
        if (context.fallbackContainer) {
          const resolved = fail(error)
          try {
            const active = container
            container = null
            unsubscribeContainer = null
            if (active?.stop) await active.stop()
            return mountContainer(context.fallbackContainer, context.initialState, true, resolved)
          } catch (fallbackError) {
            throw fail(fallbackError)
          }
        }
        throw fail(error)
      }
    },

    async unmount() {
      const active = container
      const unsubscribe = unsubscribeContainer
      container = null
      unsubscribeContainer = null

      if (unsubscribe) unsubscribe()
      if (active?.stop) await active.stop()

      updateSnapshot({
        mounted: false
      })
    },

    subscribe(listener: (next: AdapterSnapshot<TState>) => void) {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },

    async dispatch(actionType: string, payload?: any) {
      if (!container || !snapshot.mounted) {
        throw fail(new Error('Adapter container is not mounted'))
      }

      try {
        let state: TState | undefined
        if (container.dispatch) {
          state = await container.dispatch(actionType, payload)
        } else if (container.updateState && actionType === 'SET') {
          await container.updateState(payload as TState)
          state = payload as TState
        } else {
          throw new Error(`Adapter container does not support dispatch: ${actionType}`)
        }

        return updateSnapshot({
          state,
          error: null
        })
      } catch (error) {
        throw fail(error)
      }
    },

    getSnapshot() {
      return snapshot
    },

    onError(listener: (error: Error) => void) {
      errorListeners.add(listener)
      if (snapshot.error) listener(snapshot.error)
      return () => errorListeners.delete(listener)
    }
  }

  function mountContainer(
    nextContainer: AdapterContractContainer<TState>,
    initialState: TState | undefined,
    isolated: boolean,
    previousError: Error | null = null
  ) {
    container = nextContainer
    const state = readContainerState(container, initialState)
    snapshot = {
      containerId: container.id,
      mounted: true,
      state,
      error: previousError
    }

    if (container.subscribe) {
      unsubscribeContainer = container.subscribe((nextState) => {
        updateSnapshot({ state: nextState, error: null })
      })
    }

    if (isolated) {
      updateSnapshot({
        state,
        error: previousError
      })
    } else {
      emit()
    }
    return snapshot
  }
}

function readContainerState<TState>(
  container: AdapterContractContainer<TState>,
  fallback: TState | undefined
) {
  if (container.getState) return container.getState()
  if ('state' in container) return container.state
  return fallback
}
