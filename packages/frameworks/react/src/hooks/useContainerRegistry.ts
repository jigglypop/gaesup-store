import { useCallback, useState } from 'react'
import type { ContainerMetadata } from '@gaesup-state/core'
import type { ContainerData, UseContainerRegistryResult } from '../types'

export function useContainerRegistry(): UseContainerRegistryResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const unsupported = useCallback(async <T>(operation: string): Promise<T> => {
    setIsLoading(true)
    setError(null)
    try {
      throw new Error(`Container registry operation is not configured: ${operation}`)
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError)
      throw nextError
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    search: (query: string) => unsupported<ContainerMetadata[]>(`search:${query}`),
    pull: (name: string, version?: string) => unsupported<ContainerMetadata>(`pull:${name}@${version || 'latest'}`),
    push: (_container: ContainerData) => unsupported<void>('push'),
    list: () => unsupported<ContainerMetadata[]>('list'),
    remove: (name: string, version?: string) => unsupported<void>(`remove:${name}@${version || 'latest'}`),
    prune: () => unsupported<void>('prune'),
    isLoading,
    error
  }
}
