import React from 'react'
import { ContainerProvider } from '@gaesup-state/react'
import TodoApp from './components/TodoApp'
import Counter from './components/Counter'
import PerformanceBenchmark from './components/PerformanceBenchmark'

function App() {
  return (
    <ContainerProvider
      config={{
        registry: 'https://registry.gaesup.dev',
        maxContainers: 5,
        debugMode: true,
        enableMetrics: true
      }}
    >
      <div className="app">
        <header className="app-header">
          <h1>🚀 Gaesup-State Demo</h1>
          <p>WASM 컨테이너화 상태관리 라이브러리</p>
        </header>

        <main className="app-main">
          <section className="demo-section">
            <h2>📝 Todo 관리</h2>
            <TodoApp />
          </section>

          <section className="demo-section">
            <h2>🔢 WASM 카운터</h2>
            <Counter />
          </section>

          <section className="demo-section">
            <h2>⚡ 성능 벤치마크</h2>
            <PerformanceBenchmark />
          </section>
        </main>

        <footer className="app-footer">
          <p>Built with Gaesup-State • 최신 WASM 기술로 구동</p>
        </footer>
      </div>
    </ContainerProvider>
  )
}

export default App 