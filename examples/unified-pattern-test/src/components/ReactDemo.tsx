/**
 * ⚛️ React 통합 패턴 데모
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { useGaesupState } from '@gaesup-state/react'
import type { AppState } from '../main'

interface ReactDemoProps {
  initialState: AppState
}

function ReactDemo({ initialState }: ReactDemoProps) {
  // 🎯 통합 패턴 사용 - 모든 프레임워크에서 동일한 API
  const { state, actions } = useGaesupState<AppState>(initialState)
  
  const handleIncrement = () => {
    actions.update('counter', state.data.counter + 1)
  }
  
  const handleDecrement = () => {
    actions.update('counter', state.data.counter - 1)
  }
  
  const handleAddTodo = () => {
    const newTodo = {
      id: Date.now(),
      text: `React Todo ${state.data.todos.length + 1}`,
      completed: false
    }
    actions.update('todos', [...state.data.todos, newTodo])
  }
  
  const handleToggleTodo = (id: number) => {
    const updatedTodos = state.data.todos.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    )
    actions.update('todos', updatedTodos)
  }
  
  return (
    <div>
      {/* 로딩/에러 상태 */}
      {state.loading && <div className="state-display loading">로딩 중...</div>}
      {state.error && <div className="state-display error">에러: {state.error}</div>}
      
      {/* 카운터 */}
      <div className="counter-demo">
        <button onClick={handleDecrement}>-</button>
        <span>카운터: {state.data.counter}</span>
        <button onClick={handleIncrement}>+</button>
      </div>
      
      {/* 사용자 정보 */}
      <div className="state-display">
        사용자: {state.data.user.name} ({state.data.user.email})
      </div>
      
      {/* TODO 리스트 */}
      <div>
        <button onClick={handleAddTodo}>TODO 추가</button>
        <div style={{ maxHeight: '150px', overflowY: 'auto', margin: '10px 0' }}>
          {state.data.todos.map(todo => (
            <div 
              key={todo.id} 
              style={{ 
                padding: '5px', 
                textDecoration: todo.completed ? 'line-through' : 'none',
                cursor: 'pointer'
              }}
              onClick={() => handleToggleTodo(todo.id)}
            >
              {todo.completed ? '✅' : '⏳'} {todo.text}
            </div>
          ))}
        </div>
      </div>
      
      {/* 상태 JSON */}
      <div className="state-display">
        <strong>현재 상태:</strong>
        <pre style={{ fontSize: '12px', maxHeight: '100px', overflow: 'auto' }}>
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    </div>
  )
}

export async function mountReactDemo(containerId: string, initialState: AppState) {
  const container = document.getElementById(containerId)
  if (!container) {
    console.error(`Container ${containerId} not found`)
    return
  }
  
  const root = ReactDOM.createRoot(container)
  root.render(<ReactDemo initialState={initialState} />)
  
  console.log('✅ React 데모 마운트 완료')
} 