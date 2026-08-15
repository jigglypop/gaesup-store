import { describe, expect, it, vi } from 'vitest';

import { derived, state } from './graph';
import { graphResource } from './graph-resource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('graphResource', () => {
  it('is lazy: does not fetch until first read or subscribe', async () => {
    const fetch = vi.fn(async () => 'data');
    const res = graphResource({ key: () => ['users'], fetch });

    expect(fetch).not.toHaveBeenCalled();

    expect(res.get().status).toBe('loading');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(['users']);

    await tick();
    expect(res.get().status).toBe('success');
    expect(res.get().data).toBe('data');
  });

  it('refetches automatically when a state read by the key changes', async () => {
    const userId = state(1);
    const fetch = vi.fn(async ([, id]: unknown[]) => `user-${id}`);
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    const listener = vi.fn();
    res.subscribe(listener);

    await tick();
    expect(res.get().data).toBe('user-1');

    userId.set(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(['user', 2]);

    await tick();
    expect(res.get().data).toBe('user-2');
  });

  it('does not refetch when unrelated state changes or the key is deep-equal', async () => {
    const userId = state(1);
    const unrelated = state('x');
    const fetch = vi.fn(async () => 'data');
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    res.subscribe(() => {});
    await tick();

    unrelated.set('y');
    expect(fetch).toHaveBeenCalledTimes(1);

    userId.set(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores stale responses: only the latest fetch commits', async () => {
    const userId = state(1);
    const first = deferred<string>();
    const second = deferred<string>();
    const pending = [first, second];
    const fetch = vi.fn(() => pending.shift()!.promise);
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    res.subscribe(() => {});

    userId.set(2);
    expect(fetch).toHaveBeenCalledTimes(2);

    second.resolve('user-2');
    await tick();
    first.resolve('user-1-stale');
    await tick();

    expect(res.get().status).toBe('success');
    expect(res.get().data).toBe('user-2');
  });

  it('fail-closed: a rejected fetch surfaces status error and a key change retries', async () => {
    const userId = state(1);
    const fetch = vi.fn(async ([, id]: unknown[]) => {
      if (id === 1) throw new Error('server down');
      return `user-${id}`;
    });
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    res.subscribe(() => {});
    await tick();

    expect(res.get().status).toBe('error');
    expect((res.get().error as Error).message).toBe('server down');
    expect(res.get().data).toBeUndefined();

    userId.set(2);
    await tick();
    expect(res.get().status).toBe('success');
    expect(res.get().data).toBe('user-2');
    expect(res.get().error).toBeUndefined();
  });

  it('participates in the graph: derived over resource state recomputes on arrival', async () => {
    const fetch = vi.fn(async () => [1, 2, 3]);
    const res = graphResource({ key: () => ['numbers'], fetch });
    const total = derived(() => (res.get().data ?? []).reduce((sum, n) => sum + n, 0));
    const listener = vi.fn();
    total.subscribe(listener);

    expect(total.get()).toBe(0);
    await tick();

    expect(listener).toHaveBeenCalledWith(6);
    expect(total.get()).toBe(6);
  });

  it('notifies subscribers on each status transition', async () => {
    const fetch = vi.fn(async () => 'data');
    const res = graphResource({ key: () => ['k'], fetch });
    const statuses: string[] = [];
    res.subscribe((snapshot) => statuses.push(snapshot.status));

    await tick();
    expect(statuses).toEqual(['loading', 'success']);
  });

  it('supports manual refetch with the current key', async () => {
    const userId = state(7);
    const fetch = vi.fn(async ([, id]: unknown[]) => `user-${id}`);
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    res.subscribe(() => {});
    await tick();

    const value = await res.refetch();
    expect(value).toBe('user-7');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(['user', 7]);
  });
});
