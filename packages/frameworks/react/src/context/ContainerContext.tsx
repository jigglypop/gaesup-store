import React, { createContext, useContext, useEffect, useState } from 'react'
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

    const initializeManager = async () => {
      try {
        setError(null)
        const newManager = new ContainerManager(config)
        
        if (mounted) {
          setManager(newManager)
          setIsInitialized(true)
        } else {
          newManager.cleanup().catch(console.error)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to initialize container manager'))
          setIsInitialized(false)
        }
      }
    }

    initializeManager()

    return () => {
      mounted = false
      setManager((currentManager) => {
        currentManager?.cleanup().catch(console.error)
        return null
      })
    }
  }, [config])

  const contextValue: ContainerContextValue = {
    manager,
    config,
    isInitialized,
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

export { ContainerContext } 
