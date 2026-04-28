import { Suspense } from 'react'
import type { ContainerSuspenseProps } from '../types'
import { ContainerErrorBoundary } from './ContainerErrorBoundary'

export function ContainerSuspense({ fallback, children, onError }: ContainerSuspenseProps) {
  return (
    <ContainerErrorBoundary onError={(error) => onError?.(error)}>
      <Suspense fallback={fallback}>
        {children}
      </Suspense>
    </ContainerErrorBoundary>
  )
}
