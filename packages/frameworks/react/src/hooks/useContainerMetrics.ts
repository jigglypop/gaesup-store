import { useEffect, useState } from 'react'
import type { ContainerMetrics } from '@gaesup-state/core'
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
      setMetrics(manager.getMetrics() as Record<string, ContainerMetrics>)
    }

    refresh()
    const interval = window.setInterval(refresh, refreshInterval)
    return () => window.clearInterval(interval)
  }, [enabled, manager, refreshInterval])

  return metrics
}
