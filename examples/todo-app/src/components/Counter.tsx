import React from 'react'
import { useContainerState } from '@gaesup-state/react'

interface CounterState {
  count: number
  lastUpdated: Date
  totalOperations: number
}

export default function Counter() {
  const { 
    state, 
    call,
    isLoading,
    error,
    container
  } = useContainerState<CounterState>('counter:1.0.0', {
    initialState: {
      count: 0,
      lastUpdated: new Date(),
      totalOperations: 0
    }
  })

  const increment = async () => {
    try {
      await call('increment')
    } catch (err) {
      console.error('Failed to increment:', err)
    }
  }

  const decrement = async () => {
    try {
      await call('decrement')
    } catch (err) {
      console.error('Failed to decrement:', err)
    }
  }

  const reset = async () => {
    try {
      await call('reset')
    } catch (err) {
      console.error('Failed to reset:', err)
    }
  }

  const addAmount = async (amount: number) => {
    try {
      await call('addAmount', { amount })
    } catch (err) {
      console.error('Failed to add amount:', err)
    }
  }

  // 빠른 연속 증가 (성능 테스트용)
  const rapidIncrement = async () => {
    const start = performance.now()
    
    for (let i = 0; i < 100; i++) {
      await call('increment')
    }
    
    const end = performance.now()
    console.log(`100번 증가 완료: ${(end - start).toFixed(2)}ms`)
  }

  if (error) {
    return (
      <div className="error">
        <h3>❌ Counter Error</h3>
        <p>{error.message}</p>
      </div>
    )
  }

  return (
    <div className="counter">
      <div className="container-status">
        <span className={`status ${container ? 'connected' : 'disconnected'}`}>
          {container ? '🟢 WASM 카운터 활성' : '🔴 로딩 중'}
        </span>
      </div>

      <div className="counter-display">
        <div className="count-value">
          {state.count}
        </div>
        <div className="counter-info">
          <small>
            마지막 업데이트: {state.lastUpdated.toLocaleTimeString()} • 
            총 연산: {state.totalOperations}회
          </small>
        </div>
      </div>

      <div className="counter-controls">
        <button 
          onClick={decrement} 
          disabled={isLoading}
          className="counter-btn decrement"
        >
          -1
        </button>
        
        <button 
          onClick={reset} 
          disabled={isLoading}
          className="counter-btn reset"
        >
          리셋
        </button>
        
        <button 
          onClick={increment} 
          disabled={isLoading}
          className="counter-btn increment"
        >
          +1
        </button>
      </div>

      <div className="counter-advanced">
        <div className="amount-controls">
          <button onClick={() => addAmount(-10)} disabled={isLoading}>
            -10
          </button>
          <button onClick={() => addAmount(-5)} disabled={isLoading}>
            -5
          </button>
          <button onClick={() => addAmount(5)} disabled={isLoading}>
            +5
          </button>
          <button onClick={() => addAmount(10)} disabled={isLoading}>
            +10
          </button>
        </div>

        <div className="performance-test">
          <button 
            onClick={rapidIncrement} 
            disabled={isLoading}
            className="performance-btn"
          >
            🚀 빠른 100회 증가
          </button>
          <small>WASM 성능 테스트</small>
        </div>
      </div>

      {container && (
        <div className="counter-metrics">
          <h4>📊 컨테이너 메트릭</h4>
          <div className="metrics-grid">
            <div className="metric">
              <span>CPU 사용률:</span>
              <span>{container.metrics.cpuUsage.toFixed(1)}%</span>
            </div>
            <div className="metric">
              <span>메모리:</span>
              <span>{Math.round(container.metrics.memoryUsage.used / 1024)}KB</span>
            </div>
            <div className="metric">
              <span>함수 호출:</span>
              <span>{container.metrics.callCount}회</span>
            </div>
            <div className="metric">
              <span>실행 시간:</span>
              <span>{Math.round(container.metrics.uptime / 1000)}초</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 