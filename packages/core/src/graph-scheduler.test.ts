import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureScheduler,
  derived,
  state,
  subscribeTransactions,
  transaction,
  type TransactionInfo
} from './graph';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  configureScheduler({ flushMode: 'sync' });
});

describe('scheduler auto-batching (§20)', () => {
  it('coalesces same-turn writes into one microtask notification', async () => {
    configureScheduler({ flushMode: 'microtask' });
    const a = state(1);
    const b = state(2);
    const sum = derived(() => a.get() + b.get());
    const listener = vi.fn();
    sum.subscribe(listener);

    a.set(10);
    b.set(20);
    expect(listener).not.toHaveBeenCalled(); // deferred to the microtask

    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(30);
  });

  it('reads stay consistent before the flush (notifications defer, values do not)', async () => {
    configureScheduler({ flushMode: 'microtask' });
    const a = state(1);
    const doubled = derived(() => a.get() * 2);

    a.set(5);
    expect(doubled.get()).toBe(10); // pull sees the committed value immediately
    await tick();
  });

  it('sync mode remains the default behavior', () => {
    const a = state(1);
    const listener = vi.fn();
    a.subscribe(listener);

    a.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('transaction metadata (§28)', () => {
  it('reports committed transactions with id and written node ids', () => {
    const events: TransactionInfo[] = [];
    const unsubscribe = subscribeTransactions((info) => events.push(info));

    const a = state(1, { id: 'txn.a' });
    const b = state(2, { id: 'txn.b' });
    transaction(() => {
      a.set(10);
      b.set(20);
    });

    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('COMMITTED');
    expect(events[0].writes.sort()).toEqual(['txn.a', 'txn.b']);
    expect(events[0].id).toMatch(/^txn:/);
  });

  it('reports rolled-back transactions', () => {
    const events: TransactionInfo[] = [];
    const unsubscribe = subscribeTransactions((info) => events.push(info));

    const a = state(1, { id: 'txn.rollback' });
    expect(() =>
      transaction(() => {
        a.set(2);
        throw new Error('abort');
      })
    ).toThrow('abort');

    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('ROLLED_BACK');
    expect(events[0].writes).toEqual(['txn.rollback']);
  });

  it('nested transactions report once, at the outermost boundary', () => {
    const events: TransactionInfo[] = [];
    const unsubscribe = subscribeTransactions((info) => events.push(info));

    const a = state(1, { id: 'txn.outer' });
    const b = state(1, { id: 'txn.inner' });
    transaction(() => {
      a.set(2);
      transaction(() => {
        b.set(2);
      });
    });

    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].writes.sort()).toEqual(['txn.inner', 'txn.outer']);
  });

  it('isolates listener failures', () => {
    const unsubscribe = subscribeTransactions(() => {
      throw new Error('listener bug');
    });
    const a = state(1);

    expect(() =>
      transaction(() => {
        a.set(2);
      })
    ).not.toThrow();
    unsubscribe();
  });
});
