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

  it('serves a fresh cache hit without refetching (staleTime)', async () => {
    const userId = state(1);
    const fetch = vi.fn(async ([, id]: unknown[]) => `user-${id}`);
    const res = graphResource({
      key: () => ['user', userId.get()],
      fetch,
      staleTime: 60_000
    });
    res.subscribe(() => {});
    await tick();

    userId.set(2);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);

    userId.set(1); // revisit within staleTime -> cache hit, no fetch
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(res.get().status).toBe('success');
    expect(res.get().data).toBe('user-1');
  });

  it('revalidates a stale key while serving the cached data (SWR)', async () => {
    const userId = state(1);
    let generation = 0;
    const fetch = vi.fn(async ([, id]: unknown[]) => `user-${id}-gen${++generation}`);
    const res = graphResource({ key: () => ['user', userId.get()], fetch });
    const statuses: string[] = [];
    res.subscribe((snapshot) => statuses.push(`${snapshot.status}:${snapshot.data ?? ''}`));
    await tick();

    userId.set(2);
    await tick();
    userId.set(1); // staleTime defaults to 0 -> stale hit
    expect(res.get().status).toBe('stale');
    expect(res.get().data).toBe('user-1-gen1'); // cached data stays visible

    await tick();
    expect(res.get().status).toBe('success');
    expect(res.get().data).toBe('user-1-gen3');
  });

  it('dedupes concurrent fetches for the same key', async () => {
    const gate = deferred<string>();
    const fetch = vi.fn(() => gate.promise);
    const res = graphResource({ key: () => ['user'], fetch });
    res.subscribe(() => {});

    const first = res.refetch();
    const second = res.refetch();
    expect(fetch).toHaveBeenCalledTimes(1);

    gate.resolve('data');
    await expect(first).resolves.toBe('data');
    await expect(second).resolves.toBe('data');
  });

  it('invalidate clears the cache and refetches the active key', async () => {
    const fetch = vi.fn(async () => 'data');
    const res = graphResource({ key: () => ['user'], fetch, staleTime: 60_000 });
    res.subscribe(() => {});
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);

    await res.invalidate();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(res.get().status).toBe('success');
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
