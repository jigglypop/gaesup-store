import { describe, expect, it, vi } from 'vitest';

import {
  batch,
  derived,
  restoreGraph,
  snapshotGraph,
  state,
  subscribeGraphTrace,
  transaction,
  type GraphTraceEvent
} from './graph';

describe('snapshot/restore (§56-57)', () => {
  it('captures state values by id and restores them with notifications', () => {
    const count = state(1, { id: 'snap.count' });
    const name = state('ada', { id: 'snap.name' });
    const listener = vi.fn();
    count.subscribe(listener);

    const snapshot = snapshotGraph((id) => id.startsWith('snap.'));
    expect(snapshot['snap.count']).toBe(1);
    expect(snapshot['snap.name']).toBe('ada');

    count.set(99);
    name.set('grace');

    restoreGraph(snapshot);
    expect(count.get()).toBe(1);
    expect(name.get()).toBe('ada');
    expect(listener).toHaveBeenLastCalledWith(1);
  });

  it('recomputes derived nodes from restored state', () => {
    const base = state(2, { id: 'snap.base' });
    const doubled = derived(() => base.get() * 2);
    const snapshot = snapshotGraph((id) => id === 'snap.base');

    base.set(10);
    expect(doubled.get()).toBe(20);

    restoreGraph(snapshot);
    expect(doubled.get()).toBe(4);
  });

  it('restore is fail-safe: unknown ids are ignored, restore is atomic', () => {
    const count = state(1, { id: 'snap.known' });
    const listener = vi.fn();
    count.subscribe(listener);

    restoreGraph({ 'snap.ghost': 123, 'snap.known': 5 });
    expect(count.get()).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restoring identical values does not notify', () => {
    const count = state(7, { id: 'snap.same' });
    const listener = vi.fn();
    count.subscribe(listener);

    restoreGraph(snapshotGraph((id) => id === 'snap.same'));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('trace (§52-53)', () => {
  it('emits state-change events with node id and version', () => {
    const events: GraphTraceEvent[] = [];
    const unsubscribe = subscribeGraphTrace((event) => events.push(event));

    const count = state(0, { id: 'trace.count' });
    count.set(1);
    count.set(1); // no-op: must not emit

    unsubscribe();
    count.set(2); // after unsubscribe: must not emit

    const changes = events.filter((event) => event.node === 'trace.count');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('state-change');
    expect(changes[0].version).toBe(1);
    expect(typeof changes[0].timestamp).toBe('number');
  });

  it('emits derived-recompute events when a derived actually recomputes', () => {
    const count = state(1, { id: 'trace.base' });
    const doubled = derived(() => count.get() * 2, { id: 'trace.doubled' });
    doubled.get();

    const events: GraphTraceEvent[] = [];
    const unsubscribe = subscribeGraphTrace((event) => events.push(event));

    count.set(2);
    doubled.get();
    doubled.get(); // cached: must not emit again

    unsubscribe();
    expect(events.filter((event) => event.node === 'trace.doubled')).toHaveLength(1);
    expect(events.find((event) => event.node === 'trace.doubled')?.type).toBe('derived-recompute');
  });

  it('traces rollbacks as state-change events back to the original value', () => {
    const count = state(10, { id: 'trace.rollback' });
    const events: GraphTraceEvent[] = [];
    const unsubscribe = subscribeGraphTrace((event) => events.push(event));

    expect(() =>
      transaction(() => {
        count.set(11);
        throw new Error('abort');
      })
    ).toThrow('abort');

    unsubscribe();
    const changes = events.filter((event) => event.node === 'trace.rollback');
    expect(changes).toHaveLength(2); // forward write + rollback write
  });

  it('isolates listener failures from the graph write', () => {
    const unsubscribe = subscribeGraphTrace(() => {
      throw new Error('listener bug');
    });
    const count = state(0, { id: 'trace.safe' });

    expect(() => count.set(1)).not.toThrow();
    expect(count.get()).toBe(1);
    unsubscribe();
  });

  it('batch writes emit one event per committed set', () => {
    const a = state(0, { id: 'trace.a' });
    const b = state(0, { id: 'trace.b' });
    const events: GraphTraceEvent[] = [];
    const unsubscribe = subscribeGraphTrace((event) => events.push(event));

    batch(() => {
      a.set(1);
      b.set(2);
    });

    unsubscribe();
    expect(events.map((event) => event.node)).toEqual(['trace.a', 'trace.b']);
  });
});
