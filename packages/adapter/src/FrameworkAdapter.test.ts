import { describe, expect, it, vi } from 'vitest'
import {
  createFrameworkAdapter,
  createReactiveValue,
  createSignal,
  createStore,
  createSyncChannel,
  createUniversalContainer
} from './index'

describe('framework adapter', () => {
  it('subscribes to selected container state and skips equal values', async () => {
    const container = createUniversalContainer('cart', { count: 0, label: 'cart' })
    const adapter = createFrameworkAdapter({
      createReactive: createReactiveValue,
      updateReactive(reactive, value) {
        reactive.set(value)
      }
    })
    const listener = vi.fn()

    const subscription = adapter.subscribe(container, (state) => state.count)
    subscription.value.subscribe(listener)

    await adapter.patchState(container, { label: 'basket' })
    await adapter.patchState(container, { count: 1 })

    expect(subscription.value.value).toBe(1)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(adapter.getSubscriptionCount('cart')).toBe(1)

    subscription.unsubscribe()
    expect(adapter.getSubscriptionCount('cart')).toBe(0)
  })

  it('supports reactive stores, signals, sync channels, and universal calls', async () => {
    const store = createStore({ count: 0 })
    const selected = store.select((state) => state.count)
    const signal = createSignal(1)
    const channel = createSyncChannel<number>('updates')
    const seen: number[] = []
    const container = createUniversalContainer('counter', { count: 0 }, {}, async (name) => name)

    channel.subscribe((value) => seen.push(value))
    store.patch({ count: 2 })
    signal.update((value) => value + 1)
    channel.publish(signal.value)

    expect(selected.value).toBe(2)
    expect(signal.value).toBe(2)
    expect(seen).toEqual([2])
    await expect(container.call('ping')).resolves.toBe('ping')
  })
})
