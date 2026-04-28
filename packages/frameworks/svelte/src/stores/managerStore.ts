import { writable } from 'svelte/store'
import { ContainerManager, type ContainerManagerConfig } from '@gaesup-state/core'

export function createContainerManagerStore(config: ContainerManagerConfig = {}) {
  const manager = new ContainerManager(config)
  const store = writable({ manager, isInitialized: true, error: null as Error | null })

  return {
    subscribe: store.subscribe,
    manager,
    destroy: () => manager.cleanup()
  }
}

const defaultManagerStore = createContainerManagerStore()

export function getContainerManagerStore() {
  return defaultManagerStore
}
