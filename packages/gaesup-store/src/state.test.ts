import { describe, expect, it, vi } from 'vitest';
import { state } from '@gaesup/store';

describe('state', () => {
  it('test_get_returns_initial_value', () => {
    const node = state(1);
    expect(node.get()).toBe(1);
  });

  it('test_set_updates_value_returned_by_get', () => {
    const node = state('a');
    node.set('b');
    expect(node.get()).toBe('b');
  });

  it('test_subscribe_notifies_on_set', () => {
    const node = state(0);
    const fn = vi.fn();
    node.subscribe(fn);
    node.set(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('test_version_increases_monotonically_on_each_set', () => {
    // §64: version은 set 호출마다 단조 증가해야 한다.
    const node = state(0);
    const v0 = node.version;
    node.set(1);
    const v1 = node.version;
    node.set(2);
    const v2 = node.version;
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
  });

  it('test_unsubscribe_stops_further_notifications', () => {
    const node = state(0);
    const fn = vi.fn();
    const unsubscribe = node.subscribe(fn);
    unsubscribe();
    node.set(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('test_unsubscribe_does_not_affect_other_subscribers', () => {
    const node = state(0);
    const fnA = vi.fn();
    const fnB = vi.fn();
    const unsubscribeA = node.subscribe(fnA);
    node.subscribe(fnB);
    unsubscribeA();
    node.set(1);
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
