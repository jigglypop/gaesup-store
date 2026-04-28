import { useCallback, useState } from 'react'
import type { ContainerMetadata } from 'gaesup-state'
import type { ContainerData, UseContainerRegistryResult } from '../types'

export interface UseContainerRegistryOptions {
  registryUrl?: string
}

export function useContainerRegistry(options: UseContainerRegistryOptions = {}): UseContainerRegistryResult {
  const registryUrl = normalizeRegistryUrl(options.registryUrl || getDefaultRegistryUrl())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const request = useCallback(async <T>(path: string, init?: RequestInit): Promise<T> => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${registryUrl}${path}`, init)
      if (!response.ok) {
        throw new Error(`Registry request failed: ${response.status} ${response.statusText}`)
      }
      if (response.status === 204) {
        return undefined as T
      }
      return await response.json() as T
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError)
      throw nextError
    } finally {
      setIsLoading(false)
    }
  }, [registryUrl])

  const search = useCallback(async (query: string) => {
    const result = await request<{ results: ContainerMetadata[] }>(
      `/api/v1/search?q=${encodeURIComponent(query)}`
    )
    return result.results
  }, [request])

  const pull = useCallback(async (name: string, version = 'latest') => {
    const encodedName = encodeURIComponent(name)
    const container = await request<ContainerMetadata>(`/api/v1/containers/${encodedName}`)
    if (version === 'latest' || container.version === version || container.latestTag === version) {
      return container
    }
    return request<ContainerMetadata>(`/v2/${encodedName}/manifests/${encodeURIComponent(version)}`)
  }, [request])

  const push = useCallback(async (container: ContainerData) => {
    const name = encodeURIComponent(container.name)
    const version = encodeURIComponent(container.version)
    await request(`/v2/${name}/manifests/${version}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...container.metadata,
        name: container.name,
        version: container.version,
        wasmSize: container.wasmBytes.byteLength
      })
    })
  }, [request])

  const list = useCallback(async () => {
    const catalog = await request<{ repositories: string[] }>('/v2/_catalog')
    return Promise.all(catalog.repositories.map((name) => pull(name)))
  }, [pull, request])

  const remove = useCallback(async (name: string, version?: string) => {
    const encodedName = encodeURIComponent(name)
    const path = version
      ? `/api/v1/containers/${encodedName}/tags/${encodeURIComponent(version)}`
      : `/api/v1/containers/${encodedName}`
    await request<void>(path, { method: 'DELETE' })
  }, [request])

  const prune = useCallback(async () => {
    const containers = await list()
    await Promise.all(containers.map((container) => remove(container.name)))
  }, [list, remove])

  return {
    search,
    pull,
    push,
    list,
    remove,
    prune,
    isLoading,
    error
  }
}

function normalizeRegistryUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function getDefaultRegistryUrl() {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GAESUP_REGISTRY) {
    return (import.meta as any).env.VITE_GAESUP_REGISTRY as string
  }
  return 'http://localhost:5000'
}
