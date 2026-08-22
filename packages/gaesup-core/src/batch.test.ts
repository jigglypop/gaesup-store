import { describe, expect, it, vi } from 'vitest';
import { batch } from '@gaesup/core';
import { state } from '@gaesup/store';

describe('batch', () => {
  it('test_multiple_sets_inside_batch_notify_subscriber_exactly_once', () => {
    // §20: batch 내 다중 set은 구독자에게 1회만 통지되어야 한다.
    const node = state(0);
    const fn = vi.fn();
    node.subscribe(fn);

    batch(() => {
      node.set(1);
      node.set(2);
      node.set(3);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(node.get()).toBe(3);
  });

  it('test_multiple_sets_outside_batch_notify_subscriber_once_per_set', () => {
    const node = state(0);
    const fn = vi.fn();
    node.subscribe(fn);

    node.set(1);
    node.set(2);
    node.set(3);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('test_batch_notifies_multiple_distinct_nodes_each_once', () => {
    const a = state(0);
    const b = state(0);
    const fnA = vi.fn();
    const fnB = vi.fn();
    a.subscribe(fnA);
    b.subscribe(fnB);

    batch(() => {
      a.set(1);
      a.set(2);
      b.set(10);
    });

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('test_batch_with_no_sets_does_not_notify', () => {
    const node = state(0);
    const fn = vi.fn();
    node.subscribe(fn);

    batch(() => {
      // no-op
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
