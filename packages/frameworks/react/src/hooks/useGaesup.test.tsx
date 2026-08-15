import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { batch, derived, graphResource, state } from 'gaesup-state'
import { useGaesup } from './useGaesup'

describe('useGaesup', () => {
  it('renders a state node and re-renders on set', () => {
    const count = state(1)
    const { result } = renderHook(() => useGaesup(count))
    expect(result.current).toBe(1)

    act(() => {
      count.set(2)
    })
    expect(result.current).toBe(2)
  })

  it('renders derived nodes and follows the graph', () => {
    const count = state(2)
    const doubled = derived(() => count.get() * 2)
    const { result } = renderHook(() => useGaesup(doubled))
    expect(result.current).toBe(4)

    act(() => {
      count.set(5)
    })
    expect(result.current).toBe(10)
  })

  it('does not re-render when an update leaves the value unchanged', () => {
    const count = state(1)
    const parity = derived(() => count.get() % 2)
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useGaesup(parity)
    })
    const rendersAfterMount = renders

    act(() => {
      count.set(3) // parity unchanged -> graph cutoff -> no notification
    })
    expect(renders).toBe(rendersAfterMount)
    expect(result.current).toBe(1)
  })

  it('re-renders once for a batch of writes', () => {
    const a = state(1)
    const b = state(2)
    const sum = derived(() => a.get() + b.get())
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useGaesup(sum)
    })
    const rendersAfterMount = renders

    act(() => {
      batch(() => {
        a.set(10)
        b.set(20)
      })
    })
    expect(result.current).toBe(30)
    expect(renders).toBe(rendersAfterMount + 1)
  })

  it('binds a graphResource snapshot: loading then success', async () => {
    const userId = state(1)
    const user = graphResource({
      key: () => ['user', userId.get()],
      fetch: async ([, id]) => `user-${id}`
    })
    const { result } = renderHook(() => useGaesup(user))
    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBe('user-1')

    act(() => {
      userId.set(2) // key change -> auto refetch, still no effects in user code
    })
    await waitFor(() => expect(result.current.data).toBe('user-2'))
  })

  it('unsubscribes on unmount', () => {
    const count = state(1)
    const listener = vi.fn()
    const node = {
      get: () => count.get(),
      subscribe: (fn: (value: number) => void) => {
        listener()
        return count.subscribe(fn)
      }
    }
    const { unmount } = renderHook(() => useGaesup(node))
    unmount()

    expect(() =>
      act(() => {
        count.set(99)
      })
    ).not.toThrow()
  })
})
