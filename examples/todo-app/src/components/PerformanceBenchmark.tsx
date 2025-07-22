import React, { useState } from 'react'
import { useContainerState } from '@gaesup-state/react'

interface BenchmarkResult {
  testName: string
  duration: number
  operations: number
  opsPerSecond: number
  memoryUsed: number
  timestamp: Date
}

export default function PerformanceBenchmark() {
  const [results, setResults] = useState<BenchmarkResult[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const { call, container } = useContainerState('benchmark:1.0.0', {
    initialState: {}
  })

  const runBenchmark = async (testName: string, operations: number, operation: () => Promise<void>) => {
    if (isRunning || !container) return

    setIsRunning(true)
    const startMemory = container.getMemoryUsage().used
    const start = performance.now()

    try {
      for (let i = 0; i < operations; i++) {
        await operation()
      }

      const end = performance.now()
      const duration = end - start
      const endMemory = container.getMemoryUsage().used
      const memoryUsed = endMemory - startMemory

      const result: BenchmarkResult = {
        testName,
        duration,
        operations,
        opsPerSecond: Math.round((operations / duration) * 1000),
        memoryUsed,
        timestamp: new Date()
      }

      setResults(prev => [result, ...prev.slice(0, 9)]) // 최근 10개만 유지

    } catch (error) {
      console.error('Benchmark failed:', error)
    } finally {
      setIsRunning(false)
    }
  }

  const benchmarkTests = [
    {
      name: '상태 업데이트 (1,000회)',
      operations: 1000,
      operation: () => call('updateState', { value: Math.random() })
    },
    {
      name: '배열 정렬 (10,000 아이템)',
      operations: 1,
      operation: () => call('sortArray', { size: 10000 })
    },
    {
      name: '피보나치 계산 (35)',
      operations: 1,
      operation: () => call('fibonacci', { n: 35 })
    },
    {
      name: '문자열 처리 (1,000회)',
      operations: 1000,
      operation: () => call('processString', { text: 'Hello WASM World!' })
    },
    {
      name: '수학 연산 (10,000회)',
      operations: 10000,
      operation: () => call('mathOperation', { 
        a: Math.random() * 100, 
        b: Math.random() * 100 
      })
    }
  ]

  const clearResults = () => {
    setResults([])
  }

  const compareWithJS = async () => {
    if (isRunning) return

    setIsRunning(true)

    // JavaScript 벤치마크
    const jsStart = performance.now()
    for (let i = 0; i < 10000; i++) {
      Math.sqrt(Math.random() * 1000)
    }
    const jsEnd = performance.now()
    const jsDuration = jsEnd - jsStart

    // WASM 벤치마크
    const wasmStart = performance.now()
    try {
      await call('mathBenchmark', { iterations: 10000 })
    } catch (error) {
      console.error('WASM benchmark failed:', error)
    }
    const wasmEnd = performance.now()
    const wasmDuration = wasmEnd - wasmStart

    const speedup = jsDuration / wasmDuration

    const result: BenchmarkResult = {
      testName: `JS vs WASM 비교 (${speedup.toFixed(2)}x 향상)`,
      duration: wasmDuration,
      operations: 10000,
      opsPerSecond: Math.round((10000 / wasmDuration) * 1000),
      memoryUsed: container?.getMemoryUsage().used || 0,
      timestamp: new Date()
    }

    setResults(prev => [result, ...prev.slice(0, 9)])
    setIsRunning(false)
  }

  return (
    <div className="benchmark">
      <div className="benchmark-controls">
        <h3>⚡ 성능 테스트</h3>
        <p>다양한 WASM 연산의 성능을 측정해보세요</p>

        <div className="test-buttons">
          {benchmarkTests.map((test) => (
            <button
              key={test.name}
              onClick={() => runBenchmark(test.name, test.operations, test.operation)}
              disabled={isRunning || !container}
              className="test-btn"
            >
              {test.name}
            </button>
          ))}
        </div>

        <div className="special-tests">
          <button
            onClick={compareWithJS}
            disabled={isRunning || !container}
            className="compare-btn"
          >
            🏁 JS vs WASM 비교
          </button>
          
          <button
            onClick={clearResults}
            disabled={isRunning}
            className="clear-btn"
          >
            결과 지우기
          </button>
        </div>
      </div>

      {isRunning && (
        <div className="running-indicator">
          <div className="spinner"></div>
          <span>벤치마크 실행 중...</span>
        </div>
      )}

      <div className="benchmark-results">
        <h4>📈 벤치마크 결과</h4>
        
        {results.length === 0 ? (
          <p className="no-results">아직 실행된 테스트가 없습니다</p>
        ) : (
          <div className="results-table">
            <div className="results-header">
              <span>테스트</span>
              <span>시간</span>
              <span>OPS</span>
              <span>메모리</span>
              <span>실행 시각</span>
            </div>
            
            {results.map((result, index) => (
              <div key={index} className="results-row">
                <span className="test-name">{result.testName}</span>
                <span className="duration">
                  {result.duration.toFixed(2)}ms
                </span>
                <span className="ops">
                  {result.opsPerSecond.toLocaleString()}/sec
                </span>
                <span className="memory">
                  {Math.round(result.memoryUsed / 1024)}KB
                </span>
                <span className="timestamp">
                  {result.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {container && (
        <div className="system-info">
          <h4>🖥️ 시스템 정보</h4>
          <div className="info-grid">
            <div className="info-item">
              <span>컨테이너 상태:</span>
              <span className="status">{container.status}</span>
            </div>
            <div className="info-item">
              <span>총 메모리:</span>
              <span>{Math.round(container.getMemoryUsage().limit / 1024 / 1024)}MB</span>
            </div>
            <div className="info-item">
              <span>사용 메모리:</span>
              <span>{Math.round(container.getMemoryUsage().used / 1024)}KB</span>
            </div>
            <div className="info-item">
              <span>함수 호출 수:</span>
              <span>{container.metrics.callCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 