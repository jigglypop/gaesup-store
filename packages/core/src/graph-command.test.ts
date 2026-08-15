import { describe, expect, it, vi } from 'vitest';

import { derived, state, transaction } from './graph';
import { command } from './graph-command';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('transaction', () => {
  it('is atomic: observers see only the committed final state (invariant I4)', () => {
    const balanceA = state(100);
    const balanceB = state(0);
    const total = derived(() => balanceA.get() + balanceB.get());
    const listener = vi.fn();
    const totals: number[] = [];
    total.subscribe((value) => {
      listener(value);
      totals.push(value);
    });
    const aListener = vi.fn();
    balanceA.subscribe(aListener);

    transaction(() => {
      balanceA.set(balanceA.get() - 30);
      balanceB.set(balanceB.get() + 30);
    });

    expect(totals).toEqual([]);
    expect(aListener).toHaveBeenCalledTimes(1);
    expect(aListener).toHaveBeenCalledWith(70);
    expect(total.get()).toBe(100);
  });

  it('rolls back all writes when the callback throws, with no notifications', () => {
    const balanceA = state(100);
    const balanceB = state(0);
    const listener = vi.fn();
    balanceA.subscribe(listener);
    balanceB.subscribe(listener);

    expect(() =>
      transaction(() => {
        balanceA.set(70);
        balanceB.set(30);
        throw new Error('transfer failed');
      })
    ).toThrow('transfer failed');

    expect(balanceA.get()).toBe(100);
    expect(balanceB.get()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps derived nodes consistent after a rollback', () => {
    const count = state(1);
    const doubled = derived(() => count.get() * 2);
    expect(doubled.get()).toBe(2);

    expect(() =>
      transaction(() => {
        count.set(10);
        throw new Error('abort');
      })
    ).toThrow('abort');

    expect(doubled.get()).toBe(2);
  });

  it('joins nested transactions into one atomic unit', () => {
    const a = state(1);
    const b = state(1);

    expect(() =>
      transaction(() => {
        a.set(2);
        transaction(() => {
          b.set(2);
        });
        throw new Error('outer failed');
      })
    ).toThrow('outer failed');

    expect(a.get()).toBe(1);
    expect(b.get()).toBe(1);
  });

  it('returns the callback result', () => {
    expect(transaction(() => 'done')).toBe('done');
  });
});

describe('command', () => {
  it('executes and commits the result into state', async () => {
    const user = state<string | null>(null);
    const login = command({
      execute: async (name: string) => `user:${name}`,
      commit: (result) => user.set(result)
    });

    const result = await login('ada');
    expect(result).toBe('user:ada');
    expect(user.get()).toBe('user:ada');
  });

  it('applies optimistic updates immediately, then keeps them on success', async () => {
    const name = state('old');
    const seen: string[] = [];
    name.subscribe((value) => seen.push(value));

    const rename = command({
      optimistic: (next: string) => name.set(next),
      execute: async (next: string) => next.toUpperCase(),
      commit: (result) => name.set(result)
    });

    const promise = rename('new');
    expect(name.get()).toBe('new');

    await promise;
    expect(name.get()).toBe('NEW');
    expect(seen).toEqual(['new', 'NEW']);
  });

  it('rolls back the optimistic update when execute rejects', async () => {
    const name = state('old');
    const seen: string[] = [];
    name.subscribe((value) => seen.push(value));

    const rename = command({
      optimistic: (next: string) => name.set(next),
      execute: async () => {
        throw new Error('server rejected');
      }
    });

    await expect(rename('new')).rejects.toThrow('server rejected');
    expect(name.get()).toBe('old');
    expect(seen).toEqual(['new', 'old']);
  });

  it('rolls back when execute throws synchronously', async () => {
    const count = state(0);
    const bump = command({
      optimistic: () => count.set(count.get() + 1),
      execute: (): number => {
        throw new Error('sync failure');
      }
    });

    await expect(bump(undefined)).rejects.toThrow('sync failure');
    expect(count.get()).toBe(0);
  });

  it('leaves state untouched when a command without optimistic fails', async () => {
    const user = state<string | null>(null);
    const listener = vi.fn();
    user.subscribe(listener);

    const login = command({
      execute: async () => {
        throw new Error('auth failed');
      },
      commit: () => user.set('never')
    });

    await expect(login(undefined)).rejects.toThrow('auth failed');
    await tick();
    expect(user.get()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('commits atomically: multi-state commit notifies once per node', async () => {
    const a = state(0);
    const b = state(0);
    const sum = derived(() => a.get() + b.get());
    const listener = vi.fn();
    sum.subscribe(listener);

    const apply = command({
      execute: async () => ({ a: 1, b: 2 }),
      commit: (result) => {
        a.set(result.a);
        b.set(result.b);
      }
    });

    await apply(undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3);
  });
});
