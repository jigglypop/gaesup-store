import { describe, expect, it, vi } from 'vitest';

import { DependencyCycleError, batch, derived, state } from './graph';

describe('state', () => {
  it('reads and writes values with monotonically increasing versions', () => {
    const count = state(0);
    expect(count.get()).toBe(0);
    const v0 = count.version;

    count.set(10);
    expect(count.get()).toBe(10);
    expect(count.version).toBe(v0 + 1);

    count.set((previous) => previous + 5);
    expect(count.get()).toBe(15);
    expect(count.version).toBe(v0 + 2);
  });

  it('notifies subscribers with the new value and stops after unsubscribe', () => {
    const count = state(0);
    const listener = vi.fn();
    const unsubscribe = count.subscribe(listener);

    count.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);

    unsubscribe();
    count.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify or bump the version when the value is unchanged', () => {
    const count = state(1);
    const listener = vi.fn();
    count.subscribe(listener);
    const version = count.version;

    count.set(1);
    expect(listener).not.toHaveBeenCalled();
    expect(count.version).toBe(version);
  });

  it('honors a custom equals function', () => {
    const point = state({ x: 1 }, { equals: (a, b) => a.x === b.x });
    const listener = vi.fn();
    point.subscribe(listener);

    point.set({ x: 1 });
    expect(listener).not.toHaveBeenCalled();

    point.set({ x: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('derived', () => {
  it('computes from tracked dependencies and recomputes on change', () => {
    const count = state(2);
    const doubled = derived(() => count.get() * 2);

    expect(doubled.get()).toBe(4);
    count.set(5);
    expect(doubled.get()).toBe(10);
  });

  it('is lazy: does not compute until first read', () => {
    const count = state(1);
    const compute = vi.fn(() => count.get() * 2);
    const doubled = derived(compute);

    expect(compute).not.toHaveBeenCalled();
    doubled.get();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('caches until a dependency changes', () => {
    const count = state(1);
    const compute = vi.fn(() => count.get() * 2);
    const doubled = derived(compute);

    doubled.get();
    doubled.get();
    expect(compute).toHaveBeenCalledTimes(1);

    count.set(2);
    doubled.get();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not recompute nodes outside the affected subgraph', () => {
    const a = state(1);
    const b = state(1);
    const fromA = vi.fn(() => a.get() + 1);
    const fromB = vi.fn(() => b.get() + 1);
    const derivedA = derived(fromA);
    const derivedB = derived(fromB);

    derivedA.get();
    derivedB.get();

    a.set(2);
    derivedA.get();
    derivedB.get();

    expect(fromA).toHaveBeenCalledTimes(2);
    expect(fromB).toHaveBeenCalledTimes(1);
  });

  it('retracks dependencies dynamically across branches', () => {
    const useFirst = state(true);
    const first = state('first');
    const second = state('second');
    const compute = vi.fn(() => (useFirst.get() ? first.get() : second.get()));
    const picked = derived(compute);
    const listener = vi.fn();
    picked.subscribe(listener);

    expect(picked.get()).toBe('first');
    expect(compute).toHaveBeenCalledTimes(1);

    second.set('second-changed');
    expect(compute).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

    useFirst.set(false);
    expect(picked.get()).toBe('second-changed');

    const computeCount = compute.mock.calls.length;
    first.set('first-changed');
    expect(compute).toHaveBeenCalledTimes(computeCount);
  });

  it('propagates through a diamond glitch-free: one notification, consistent value', () => {
    const a = state(1);
    const b = derived(() => a.get() + 1);
    const c = derived(() => a.get() * 10);
    const d = derived(() => b.get() + c.get());
    const listener = vi.fn();
    d.subscribe(listener);

    expect(d.get()).toBe(12);

    a.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(23);
  });

  it('cuts off propagation when a derived value is unchanged', () => {
    const count = state(1);
    const parity = derived(() => count.get() % 2);
    const downstream = vi.fn(() => (parity.get() === 0 ? 'even' : 'odd'));
    const label = derived(downstream);
    const listener = vi.fn();
    label.subscribe(listener);
    label.get();

    count.set(3);
    expect(listener).not.toHaveBeenCalled();
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('supports chained derived nodes', () => {
    const count = state(1);
    const doubled = derived(() => count.get() * 2);
    const quadrupled = derived(() => doubled.get() * 2);

    expect(quadrupled.get()).toBe(4);
    count.set(3);
    expect(quadrupled.get()).toBe(12);
  });

  it('notifies subscribers when the derived value changes', () => {
    const count = state(1);
    const doubled = derived(() => count.get() * 2);
    const listener = vi.fn();
    doubled.subscribe(listener);

    count.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(4);
  });
});

describe('batch', () => {
  it('coalesces multiple writes into a single notification', () => {
    const a = state(1);
    const b = state(2);
    const sum = derived(() => a.get() + b.get());
    const listener = vi.fn();
    sum.subscribe(listener);

    batch(() => {
      a.set(10);
      b.set(20);
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(30);
  });

  it('supports nested batches, flushing once at the outermost boundary', () => {
    const a = state(1);
    const listener = vi.fn();
    a.subscribe(listener);

    batch(() => {
      a.set(2);
      batch(() => {
        a.set(3);
      });
      expect(listener).not.toHaveBeenCalled();
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3);
  });

  it('returns the callback result and still flushes when the callback throws', () => {
    const a = state(1);
    const listener = vi.fn();
    a.subscribe(listener);

    expect(batch(() => 'result')).toBe('result');

    expect(() =>
      batch(() => {
        a.set(2);
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('skips notification entirely when a batch reverts the value', () => {
    const a = state(1);
    const listener = vi.fn();
    a.subscribe(listener);

    batch(() => {
      a.set(2);
      a.set(1);
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('fail-closed: dependency cycles', () => {
  it('throws GAESUP_DEPENDENCY_CYCLE on a self-referencing derived', () => {
    const loop: { get(): number } = derived((): number => loop.get() + 1);
    expect(() => loop.get()).toThrow(DependencyCycleError);
  });

  it('throws GAESUP_DEPENDENCY_CYCLE on an indirect cycle and reports the path', () => {
    const a: { get(): number } = derived((): number => b.get() + 1);
    const b: { get(): number } = derived((): number => a.get() + 1);

    try {
      a.get();
      expect.unreachable('cycle must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyCycleError);
      expect((error as DependencyCycleError).code).toBe('GAESUP_DEPENDENCY_CYCLE');
      expect((error as DependencyCycleError).path.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('recovers after a failed compute: next read retries', () => {
    const shouldThrow = state(true);
    const risky = derived(() => {
      if (shouldThrow.get()) throw new Error('compute failed');
      return 'ok';
    });

    expect(() => risky.get()).toThrow('compute failed');
    shouldThrow.set(false);
    expect(risky.get()).toBe('ok');
  });
});
