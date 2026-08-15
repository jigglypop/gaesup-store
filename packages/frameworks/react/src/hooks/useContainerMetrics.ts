import { useEffect, useState } from 'react'
import type { ContainerMetrics } from 'gaesup-state'
import type { UseContainerMetricsOptions } from '../types'
import { useContainerContext } from '../context/ContainerContext'

export function useContainerMetrics(options: UseContainerMetricsOptions = {}) {
  const { refreshInterval = 1000, enabled = true } = options
  const { manager } = useContainerContext()
  const [metrics, setMetrics] = useState<Record<string, ContainerMetrics> | null>(null)

  useEffect(() => {
    if (!enabled || !manager) {
      return undefined
    }

    const refresh = () => {
      try {
        const next: Record<string, ContainerMetrics> = {}
        for (const metadata of manager.listContainers()) {
          const id = typeof metadata.id === 'string' ? metadata.id : ''
          if (!id) continue
          next[id] = manager.getContainer(id).getMetrics()
        }
        setMetrics(next)
      } catch {
        // Runtime not ready yet; keep the previous snapshot.
      }
    }

    refresh()
    const interval = window.setInterval(refresh, refreshInterval)
    return () => window.clearInterval(interval)
  }, [enabled, manager, refreshInterval])

  return metrics
}
