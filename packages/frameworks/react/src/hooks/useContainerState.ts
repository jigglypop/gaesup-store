import { useState, useEffect, useCallback, useRef } from 'react'
import type { ContainerInstance, ContainerConfig } from 'gaesup-state'
import type { UseContainerStateOptions, UseContainerStateResult } from '../types'
import { useContainerContext } from '../context/ContainerContext'

export function useContainerState<T = any>(
  containerName: string,
  options: UseContainerStateOptions<T> = {}
): UseContainerStateResult<T> {
  const {
    initialState,
    autoStart = true,
    containerConfig = {},
    onError,
    onStateChange,
    suspense = false,
    retryCount = 3,
    retryDelay = 1000
  } = options

  const { manager, isInitialized, error: contextError } = useContainerContext()
  const [state, setState] = useState<T>(initialState as T)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [container, setContainer] = useState<ContainerInstance | null>(null)
  
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)

  // 컨테이너 시작
  const startContainer = useCallback(async () => {
    if (!manager || !isInitialized) {
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const containerInstance = await manager.createContainer({
        ...containerConfig,
        name: containerName
      })

      if (mountedRef.current) {
        setContainer(containerInstance)

        // 초기 상태 설정
        if (initialState !== undefined) {
          await containerInstance.setState(initialState)
        }

        // ContainerInstance는 per-instance 구독 채널이 없으므로 시작 시점의
        // 상태를 읽어 동기화하고, 이후에는 setState/refresh 경로로 갱신한다.
        try {
          const currentState = containerInstance.getState() as T
          setState(currentState)
          onStateChange?.(currentState)
        } catch {
          // 상태가 아직 없으면 initialState 유지
        }

        retryCountRef.current = 0
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Container startup failed')
      
      if (mountedRef.current) {
        setError(error)
        onError?.(error)

        // 재시도 로직
        if (retryCountRef.current < retryCount) {
          retryCountRef.current++
          setTimeout(() => {
            if (mountedRef.current) {
              startContainer()
            }
          }, retryDelay * retryCountRef.current)
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [manager, isInitialized, containerName, containerConfig, initialState, onStateChange, onError, retryCount, retryDelay])

  // 컨테이너 중지
  const stopContainer = useCallback(async () => {
    if (container) {
      try {
        await container.stop()
        
        if (mountedRef.current) {
          setContainer(null)
          setState(initialState as T)
        }
      } catch (err) {
        console.error('Failed to stop container:', err)
      }
    }
  }, [container, initialState])

  // 함수 호출
  const call = useCallback(async <R = any>(functionName: string, args?: any): Promise<R> => {
    if (!container) {
      throw new Error('Container not available')
    }

    try {
      const result = (await container.call(functionName, args)) as R
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Function call failed')
      setError(error)
      onError?.(error)
      throw error
    }
  }, [container, onError])

  // 상태 업데이트
  const updateState = useCallback(async (newState: T | ((prev: T) => T)) => {
    if (!container) {
      throw new Error('Container not available')
    }

    try {
      const resolvedState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(state)
        : newState

      await container.setState(resolvedState)
      
      if (mountedRef.current) {
        setState(resolvedState)
        onStateChange?.(resolvedState)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('State update failed')
      setError(error)
      onError?.(error)
      throw error
    }
  }, [container, state, onStateChange, onError])

  // 컨테이너 재시작
  const restart = useCallback(async () => {
    await stopContainer()
    await startContainer()
  }, [stopContainer, startContainer])

  // 수동 새로고침
  const refresh = useCallback(async () => {
    if (container) {
      try {
        const currentState = container.getState() as T
        if (mountedRef.current) {
          setState(currentState)
          onStateChange?.(currentState)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Refresh failed')
        setError(error)
        onError?.(error)
      }
    }
  }, [container, onStateChange, onError])

  // 컨테이너 자동 시작
  useEffect(() => {
    if (autoStart && manager && isInitialized && !container && !isLoading) {
      startContainer()
    }
  }, [autoStart, manager, isInitialized, container, isLoading, startContainer])

  // Context 에러 처리
  useEffect(() => {
    if (contextError) {
      setError(contextError)
      onError?.(contextError)
    }
  }, [contextError, onError])

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (container) {
        container.stop().catch(console.error)
      }
    }
  }, [container])

  // Suspense 지원
  if (suspense && isLoading && !container) {
    throw startContainer() // Promise를 throw하여 Suspense 트리거
  }

  // 에러 상태에서 에러 던지기 (ErrorBoundary 지원)
  if (suspense && error) {
    throw error
  }

  return {
    state,
    isLoading,
    error: error || contextError,
    container,
    call,
    setState: updateState,
    restart,
    refresh
  }
} 
