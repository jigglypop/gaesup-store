import { shallowRef } from 'vue'
import { ContainerManager, type ContainerManagerConfig } from 'gaesup-state'

const managerRef = shallowRef<ContainerManager | null>(null)

export function provideContainerManager(config: ContainerManagerConfig = {}) {
  managerRef.value?.cleanup().catch(console.error)
  managerRef.value = new ContainerManager(config)
  return managerRef
}

export function useContainerManager() {
  if (!managerRef.value) {
    managerRef.value = new ContainerManager()
  }
  return managerRef
}
