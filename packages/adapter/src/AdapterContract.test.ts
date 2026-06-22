import { describe, expect, it, vi } from 'vitest'
import { createAdapterContract } from './AdapterContract'
import type { AdapterContractContainer } from './types'

describe('createAdapterContract', () => {
  it('cleans subscriptions and stops the previous container on repeated mount', async () => {
    const adapter = createAdapterContract<{ count: number }>()
    const first = fakeContainer('first')
    const second = fakeContainer('second')

    await adapter.mount({ container: first })
    await adapter.mount({ container: second })

    expect(first.unsubscribe).toHaveBeenCalledOnce()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(adapter.getSnapshot()).toMatchObject({
      containerId: 'second',
      mounted: true,
      state: { count: 0 },
      error: null
    })
  })

  it('propagates dispatch failures through onError', async () => {
    const adapter = createAdapterContract()
    const error = new Error('dispatch failed')
    const onError = vi.fn()
    adapter.onError(onError)

    await adapter.mount({
      container: {
        id: 'broken',
        state: {},
        dispatch: () => {
          throw error
        }
      }
    })

    await expect(adapter.dispatch('BROKEN')).rejects.toBe(error)
    expect(onError).toHaveBeenCalledWith(error)
    expect(adapter.getSnapshot().error).toBe(error)
  })

  it('mounts an isolated fallback container when the primary container mount fails', async () => {
    const adapter = createAdapterContract<{ count: number }>()
    const error = new Error('primary subscribe failed')
    const onError = vi.fn()
    adapter.onError(onError)

    const snapshot = await adapter.mount({
      container: {
        id: 'primary',
        state: { count: 1 },
        subscribe: () => {
          throw error
        }
      },
      fallbackContainer: {
        id: 'isolated',
        state: { count: 10 },
        subscribe: () => vi.fn()
      }
    })

    expect(snapshot).toMatchObject({
      containerId: 'isolated',
      mounted: true,
      state: { count: 10 },
      error
    })
    expect(onError).toHaveBeenCalledWith(error)
  })
})

function fakeContainer(id: string) {
  const unsubscribe = vi.fn()
  const stop = vi.fn()
  const container: AdapterContractContainer<{ count: number }> & {
    unsubscribe: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  } = {
    id,
    state: { count: 0 },
    subscribe: () => unsubscribe,
    dispatch: async (_actionType, payload) => payload,
    unsubscribe,
    stop
  }
  return container
}
