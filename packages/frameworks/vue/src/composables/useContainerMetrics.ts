import { onUnmounted, ref } from 'vue'
import type { ContainerMetrics } from 'gaesup-state'
import { useContainerManager } from './useContainerManager'

export function useContainerMetrics(refreshInterval = 1000) {
  const manager = useContainerManager()
  const metrics = ref<Record<string, ContainerMetrics> | null>(null)

  const refresh = () => {
    metrics.value = manager.value?.getMetrics() as Record<string, ContainerMetrics>
  }

  refresh()
  const interval = setInterval(refresh, refreshInterval)
  onUnmounted(() => clearInterval(interval))

  return { metrics, refresh }
}
