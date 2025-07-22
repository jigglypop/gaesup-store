import React, { Component, ComponentType, ReactNode } from 'react'
import type { ContainerErrorBoundaryProps } from '../types'

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: any
}

export class ContainerErrorBoundary extends Component<ContainerErrorBoundaryProps, State> {
  private resetTimeoutId: number | null = null

  constructor(props: ContainerErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)

    // 개발 모드에서 에러 로깅
    if (process.env.NODE_ENV === 'development') {
      console.group('🔥 Container Error Boundary')
      console.error('Error:', error)
      console.error('Error Info:', errorInfo)
      console.groupEnd()
    }
  }

  componentDidUpdate(prevProps: ContainerErrorBoundaryProps) {
    const { resetOnPropsChange, resetKeys } = this.props
    const { hasError } = this.state

    if (hasError && !prevProps.hasError) {
      // 에러 발생 직후
      return
    }

    if (hasError) {
      // props 변경으로 인한 리셋 체크
      if (resetOnPropsChange) {
        this.reset()
        return
      }

      // resetKeys 변경으로 인한 리셋 체크
      if (resetKeys && prevProps.resetKeys) {
        const hasResetKeyChanged = resetKeys.some(
          (key, index) => key !== prevProps.resetKeys?.[index]
        )
        
        if (hasResetKeyChanged) {
          this.reset()
        }
      }
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    const { hasError, error } = this.state
    const { children, fallback: Fallback } = this.props

    if (hasError && error) {
      if (Fallback) {
        return <Fallback error={error} reset={this.reset} />
      }

      return <DefaultErrorFallback error={error} reset={this.reset} />
    }

    return children
  }
}

interface DefaultErrorFallbackProps {
  error: Error
  reset: () => void
}

const DefaultErrorFallback: ComponentType<DefaultErrorFallbackProps> = ({ error, reset }) => (
  <div style={{
    padding: '24px',
    border: '2px solid #ff6b6b',
    borderRadius: '12px',
    backgroundColor: '#fff5f5',
    color: '#c92a2a',
    margin: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '600px'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
      <span style={{ fontSize: '24px', marginRight: '12px' }}>⚠️</span>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
        Something went wrong
      </h2>
    </div>
    
    <p style={{ 
      margin: '0 0 16px 0', 
      fontSize: '14px', 
      lineHeight: '1.5',
      color: '#666'
    }}>
      An error occurred in the WASM container system. This might be due to:
    </p>
    
    <ul style={{ 
      margin: '0 0 20px 0', 
      paddingLeft: '20px',
      fontSize: '14px',
      color: '#666'
    }}>
      <li>Container failed to load or initialize</li>
      <li>Invalid WASM module or runtime error</li>
      <li>Network connectivity issues</li>
      <li>Memory or resource constraints</li>
    </ul>

    <div style={{ 
      display: 'flex', 
      gap: '12px', 
      alignItems: 'center',
      marginBottom: '16px'
    }}>
      <button
        onClick={reset}
        style={{
          backgroundColor: '#228be6',
          color: 'white',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '14px',
          cursor: 'pointer',
          fontWeight: '500'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#1971c2'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = '#228be6'
        }}
      >
        Try Again
      </button>
      
      <button
        onClick={() => window.location.reload()}
        style={{
          backgroundColor: 'transparent',
          color: '#495057',
          border: '1px solid #ced4da',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '14px',
          cursor: 'pointer'
        }}
      >
        Reload Page
      </button>
    </div>

    <details style={{ fontSize: '12px' }}>
      <summary style={{ 
        cursor: 'pointer', 
        marginBottom: '8px',
        fontWeight: '500',
        color: '#495057'
      }}>
        Technical Details
      </summary>
      <div style={{
        backgroundColor: '#f8f9fa',
        border: '1px solid #e9ecef',
        borderRadius: '6px',
        padding: '12px',
        fontFamily: 'Monaco, Consolas, monospace',
        fontSize: '11px',
        color: '#495057',
        overflow: 'auto',
        maxHeight: '200px'
      }}>
        <div style={{ marginBottom: '8px' }}>
          <strong>Error:</strong> {error.name}
        </div>
        <div style={{ marginBottom: '8px' }}>
          <strong>Message:</strong> {error.message}
        </div>
        {error.stack && (
          <div>
            <strong>Stack trace:</strong>
            <pre style={{ 
              margin: '4px 0 0 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {error.stack}
            </pre>
          </div>
        )}
      </div>
    </details>
  </div>
) 