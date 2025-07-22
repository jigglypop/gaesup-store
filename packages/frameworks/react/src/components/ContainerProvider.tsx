import React, { ComponentType } from 'react'
import { ContainerContextProvider } from '../context/ContainerContext'
import type { ContainerProviderProps } from '../types'
import { ContainerErrorBoundary } from './ContainerErrorBoundary'

export function ContainerProvider({ 
  config, 
  children, 
  fallback: ErrorFallback 
}: ContainerProviderProps) {
  const ErrorComponent = ErrorFallback || DefaultErrorFallback

  return (
    <ContainerErrorBoundary fallback={ErrorComponent}>
      <ContainerContextProvider config={config}>
        {children}
      </ContainerContextProvider>
    </ContainerErrorBoundary>
  )
}

const DefaultErrorFallback: ComponentType<{ error: Error }> = ({ error }) => (
  <div style={{
    padding: '20px',
    border: '1px solid #ff6b6b',
    borderRadius: '8px',
    backgroundColor: '#ffe0e0',
    color: '#c92a2a',
    margin: '20px',
    fontFamily: 'system-ui, sans-serif'
  }}>
    <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
      Container Error
    </h3>
    <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
      Failed to initialize WASM container system
    </p>
    <details style={{ fontSize: '12px' }}>
      <summary style={{ cursor: 'pointer', marginBottom: '5px' }}>
        Error Details
      </summary>
      <pre style={{ 
        backgroundColor: '#f8f8f8', 
        padding: '10px', 
        borderRadius: '4px',
        overflow: 'auto',
        margin: 0
      }}>
        {error.message}
        {error.stack && `\n\n${error.stack}`}
      </pre>
    </details>
  </div>
) 