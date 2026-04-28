import { useContainerContext } from '../context/ContainerContext'

export function useContainerManager() {
  const { manager, config, isInitialized, error } = useContainerContext()

  return {
    manager,
    config,
    isInitialized,
    error
  }
}
