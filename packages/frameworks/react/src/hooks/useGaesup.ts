import { useCallback, useSyncExternalStore } from 'react'

// Any graph-plane node: state, derived, consumed mesh facade, graphResource,
// or graphStream — everything with the get/subscribe contract.
export interface GaesupReadableNode<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

// Spec §32: the React adapter binds a graph node to a component with
// useSyncExternalStore. The component re-renders only when the node's value
// actually changes (the graph's equals/version cutoff already filtered
// no-op updates before the subscription fires).
export function useGaesup<T>(node: GaesupReadableNode<T>): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => node.subscribe(() => onStoreChange()),
    [node]
  )
  const getSnapshot = useCallback(() => node.get(), [node])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
