import React, { useState } from 'react'
import { useContainerState } from '@gaesup-state/react'

interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: Date
}

export default function TodoApp() {
  const [newTodo, setNewTodo] = useState('')
  
  // WASM 컨테이너에서 상태 관리
  const { 
    state: todos, 
    call, 
    isLoading, 
    error,
    container 
  } = useContainerState<Todo[]>('todo-manager:1.0.0', {
    initialState: [],
    autoStart: true,
    onError: (error) => {
      console.error('Todo container error:', error)
    }
  })

  const addTodo = async () => {
    if (!newTodo.trim()) return
    
    try {
      await call('addTodo', {
        title: newTodo.trim(),
        completed: false
      })
      setNewTodo('')
    } catch (err) {
      console.error('Failed to add todo:', err)
    }
  }

  const toggleTodo = async (id: number) => {
    try {
      await call('toggleTodo', { id })
    } catch (err) {
      console.error('Failed to toggle todo:', err)
    }
  }

  const removeTodo = async (id: number) => {
    try {
      await call('removeTodo', { id })
    } catch (err) {
      console.error('Failed to remove todo:', err)
    }
  }

  const clearCompleted = async () => {
    try {
      await call('clearCompleted')
    } catch (err) {
      console.error('Failed to clear completed:', err)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      addTodo()
    }
  }

  if (error) {
    return (
      <div className="error">
        <h3>❌ Error</h3>
        <p>{error.message}</p>
        <button onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    )
  }

  const completedCount = todos.filter(t => t.completed).length
  const remainingCount = todos.length - completedCount

  return (
    <div className="todo-app">
      <div className="container-status">
        <span className={`status ${container ? 'connected' : 'disconnected'}`}>
          {container ? '🟢 컨테이너 연결됨' : '🔴 연결 대기 중'}
        </span>
      </div>

      <div className="todo-input">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="새 할 일을 입력하세요..."
          disabled={isLoading}
        />
        <button 
          onClick={addTodo} 
          disabled={isLoading || !newTodo.trim()}
        >
          {isLoading ? '추가 중...' : '추가'}
        </button>
      </div>

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="empty-state">
            <p>📝 아직 할 일이 없습니다</p>
            <p>위에서 새 할 일을 추가해보세요!</p>
          </div>
        ) : (
          todos.map((todo) => (
            <div 
              key={todo.id} 
              className={`todo-item ${todo.completed ? 'completed' : ''}`}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              <span className="todo-title">{todo.title}</span>
              <span className="todo-date">
                {new Date(todo.createdAt).toLocaleTimeString()}
              </span>
              <button 
                onClick={() => removeTodo(todo.id)}
                className="remove-btn"
                title="삭제"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>

      <div className="todo-stats">
        <div className="stats-item">
          <span className="label">전체:</span>
          <span className="value">{todos.length}개</span>
        </div>
        <div className="stats-item">
          <span className="label">완료:</span>
          <span className="value">{completedCount}개</span>
        </div>
        <div className="stats-item">
          <span className="label">남은 작업:</span>
          <span className="value">{remainingCount}개</span>
        </div>
        
        {completedCount > 0 && (
          <button 
            onClick={clearCompleted}
            className="clear-btn"
          >
            완료된 항목 정리
          </button>
        )}
      </div>

      <div className="performance-info">
        <small>
          ⚡ WASM 컨테이너로 구동 • 
          {container && (
            <>
              메모리: {Math.round(container.getMemoryUsage().used / 1024)}KB • 
              상태: {container.status}
            </>
          )}
        </small>
      </div>
    </div>
  )
} 