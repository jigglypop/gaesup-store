import { describe, expect, it, vi } from 'vitest';

import { derived, state } from './graph';
import { GraphMeshError, createGraphMesh, type ConsumedNode } from './graph-mesh';

describe('expose/consume', () => {
  it('consumes an exposed state as a readable, subscribable node', () => {
    const mesh = createGraphMesh();
    const user = state<{ name: string } | null>(null);
    mesh.expose('auth', { user });

    const consumed = mesh.consume<ConsumedNode<{ name: string } | null>>('auth.user');
    expect(consumed.get()).toBeNull();

    const listener = vi.fn();
    consumed.subscribe(listener);
    user.set({ name: 'Ada' });

    expect(consumed.get()).toEqual({ name: 'Ada' });
    expect(listener).toHaveBeenCalledWith({ name: 'Ada' });
  });

  it('keeps consumed nodes read-only: no set is exposed (invariant I2)', () => {
    const mesh = createGraphMesh();
    const user = state('Ada');
    mesh.expose('auth', { user });

    const consumed = mesh.consume<ConsumedNode<string>>('auth.user');
    expect((consumed as any).set).toBeUndefined();
  });

  it('participates in the consumer graph: derived over a consumed node retracks', () => {
    const mesh = createGraphMesh();
    const count = state(1);
    mesh.expose('counter', { count });

    const consumed = mesh.consume<ConsumedNode<number>>('counter.count');
    const doubled = derived(() => consumed.get() * 2);
    const listener = vi.fn();
    doubled.subscribe(listener);

    count.set(5);
    expect(listener).toHaveBeenCalledWith(10);
  });

  it('consumes exposed derived nodes and plain functions (commands)', () => {
    const mesh = createGraphMesh();
    const count = state(2);
    const doubled = derived(() => count.get() * 2);
    const increment = vi.fn(() => count.set(count.get() + 1));
    mesh.expose('counter', { doubled, increment });

    const consumedDoubled = mesh.consume<ConsumedNode<number>>('counter.doubled');
    expect(consumedDoubled.get()).toBe(4);

    const consumedIncrement = mesh.consume<() => void>('counter.increment');
    consumedIncrement();
    expect(increment).toHaveBeenCalledTimes(1);
    expect(consumedDoubled.get()).toBe(6);
  });

  it('records dependency edges for introspection', () => {
    const mesh = createGraphMesh();
    mesh.expose('auth', { user: state(null) });

    mesh.consume('auth.user', { consumer: 'portfolio' });
    mesh.consume('auth.user', { consumer: 'header' });

    expect(mesh.dependencies()).toEqual([
      { address: 'auth.user', consumer: 'portfolio', required: true },
      { address: 'auth.user', consumer: 'header', required: true }
    ]);
  });
});

describe('fail-closed paths', () => {
  it('throws GAESUP_DEPENDENCY_UNAVAILABLE for an unknown address (required by default)', () => {
    const mesh = createGraphMesh();
    mesh.expose('auth', { user: state(null) });

    try {
      mesh.consume('auth.missing');
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GraphMeshError);
      expect((error as GraphMeshError).code).toBe('GAESUP_DEPENDENCY_UNAVAILABLE');
    }

    expect(() => mesh.consume('nowhere.user')).toThrow(GraphMeshError);
  });

  it('returns undefined for optional dependencies instead of throwing', () => {
    const mesh = createGraphMesh();

    const consumed = mesh.consume('recommendation.data', { required: false });
    expect(consumed).toBeUndefined();
    expect(mesh.dependencies()).toEqual([
      { address: 'recommendation.data', consumer: undefined, required: false }
    ]);
  });

  it('throws GAESUP_EXPOSE_CONFLICT when a namespace key is exposed twice', () => {
    const mesh = createGraphMesh();
    mesh.expose('auth', { user: state(null) });

    try {
      mesh.expose('auth', { user: state(null) });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as GraphMeshError).code).toBe('GAESUP_EXPOSE_CONFLICT');
    }
  });

  it('allows extending a namespace with new keys', () => {
    const mesh = createGraphMesh();
    mesh.expose('auth', { user: state(null) });
    mesh.expose('auth', { session: state('s1') });

    expect(mesh.consume<ConsumedNode<string>>('auth.session').get()).toBe('s1');
  });

  it('throws GAESUP_INVALID_ADDRESS for malformed addresses', () => {
    const mesh = createGraphMesh();

    for (const address of ['auth', '.user', 'auth.', '', 'a.b.c']) {
      try {
        mesh.consume(address);
        expect.unreachable(`must throw for "${address}"`);
      } catch (error) {
        expect((error as GraphMeshError).code).toBe('GAESUP_INVALID_ADDRESS');
      }
    }
  });
});
