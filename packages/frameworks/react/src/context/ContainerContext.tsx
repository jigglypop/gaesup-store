import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ContainerManager, type ContainerManagerConfig } from '@gaesup-state/core'
import type { ContainerContextValue } from '../types'

const ContainerContext = createContext<ContainerContextValue | null>(null)

export interface ContainerContextProviderProps {
  config: ContainerManagerConfig
  children: React.ReactNode
}

export function ContainerContextProvider({ config, children }: ContainerContextProviderProps) {
  const [manager, setManager] = useState<ContainerManager | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // 매니저 초기화
  useEffect(() => {
    let mounted = true

    try {
      setError(null)
      const newManager = new ContainerManager(config)
      if (mounted) {
        setManager(newManager)
        setIsInitialized(true)
      }
    } catch (err) {
      if (mounted) {
        setError(err instanceof Error ? err : new Error('Failed to initialize container manager'))
        setIsInitialized(false)
      }
    }

    return () => {
      mounted = false
      if (manager) {
        manager.cleanup().catch(console.error)
      }
    }
  }, [config])

  // 설정 변경 시 매니저 재생성
  useEffect(() => {
    if (!manager) return
    const shouldReinitialize = hasConfigChanged((manager as any).config ?? {}, config)
    if (shouldReinitialize) {
      setIsInitialized(false)
      manager.cleanup().then(() => {
        const newManager = new ContainerManager(config)
        setManager(newManager)
        setIsInitialized(true)
      }).catch(setError)
    }
  }, [config, manager])

  const contextValue: ContainerContextValue = {
    manager,
    config,
    isInitialized: !!manager && isInitialized,
    error
  }

  return (
    <ContainerContext.Provider value={contextValue}>
      {children}
    </ContainerContext.Provider>
  )
}

export function useContainerContext(): ContainerContextValue {
  const context = useContext(ContainerContext)
  
  if (!context) {
    throw new Error('useContainerContext must be used within a ContainerProvider')
  }

  return context
}

// 설정 변경 감지 헬퍼
function hasConfigChanged(
  oldConfig: ContainerManagerConfig, 
  newConfig: ContainerManagerConfig
): boolean {
  const oldKeys = Object.keys(oldConfig).sort()
  const newKeys = Object.keys(newConfig).sort()
  
  if (oldKeys.length !== newKeys.length) {
    return true
  }

  for (const key of oldKeys) {
    if (oldConfig[key] !== newConfig[key]) {
      return true
    }
  }

  return false
}

export { ContainerContext } 