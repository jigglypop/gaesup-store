import { describe, expect, it, vi } from 'vitest';
import { state, derived } from '@gaesup/store';

describe('derived', () => {
  it('test_get_returns_computed_value_from_dependency', () => {
    const base = state(2);
    const doubled = derived(() => base.get() * 2);
    expect(doubled.get()).toBe(4);
  });

  it('test_recomputes_when_auto_collected_dependency_changes', () => {
    // §17: derived는 compute() 실행 중 접근한 노드를 자동으로 의존성으로 수집한다.
    const base = state(1);
    const doubled = derived(() => base.get() * 2);
    expect(doubled.get()).toBe(2);
    base.set(5);
    expect(doubled.get()).toBe(10);
  });

  it('test_compute_not_rerun_when_unrelated_state_changes', () => {
    // §19: 의존하지 않는 state가 변경돼도 compute는 재실행되지 않는다.
    const dep = state(1);
    const unrelated = state('irrelevant');
    const computeFn = vi.fn(() => dep.get() * 10);
    const d = derived(computeFn);

    d.get();
    expect(computeFn).toHaveBeenCalledTimes(1);

    unrelated.set('changed');
    d.get();
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  it('test_subscribe_notifies_when_dependency_changes', () => {
    const base = state(1);
    const doubled = derived(() => base.get() * 2);
    const fn = vi.fn();
    doubled.subscribe(fn);
    base.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('test_derived_of_derived_propagates_updates', () => {
    const base = state(1);
    const doubled = derived(() => base.get() * 2);
    const quadrupled = derived(() => doubled.get() * 2);

    expect(quadrupled.get()).toBe(4);
    base.set(2);
    expect(quadrupled.get()).toBe(8);
  });

  it('test_derived_of_derived_notifies_subscriber_on_root_change', () => {
    const base = state(1);
    const doubled = derived(() => base.get() * 2);
    const quadrupled = derived(() => doubled.get() * 2);
    const fn = vi.fn();
    quadrupled.subscribe(fn);

    base.set(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(quadrupled.get()).toBe(12);
  });
});
