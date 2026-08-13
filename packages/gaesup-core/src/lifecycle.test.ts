import { describe, expect, it } from 'vitest';
import { canTransition, assertTransition, GaesupError, type ContainerStatus } from '@gaesup/core';

// §10 정상 흐름:
// CREATED -> RESOLVING -> READY -> STARTING -> ACTIVE -> SUSPENDED -> ACTIVE
//   -> STOPPING -> STOPPED -> DESTROYED
// 추가로 any -> FAILED, FAILED -> DESTROYED 허용.

const HAPPY_PATH: Array<[ContainerStatus, ContainerStatus]> = [
  ['CREATED', 'RESOLVING'],
  ['RESOLVING', 'READY'],
  ['READY', 'STARTING'],
  ['STARTING', 'ACTIVE'],
  ['ACTIVE', 'SUSPENDED'],
  ['SUSPENDED', 'ACTIVE'],
  ['ACTIVE', 'STOPPING'],
  ['STOPPING', 'STOPPED'],
  ['STOPPED', 'DESTROYED'],
];

const ALL_STATUSES: ContainerStatus[] = [
  'CREATED',
  'RESOLVING',
  'READY',
  'STARTING',
  'ACTIVE',
  'SUSPENDED',
  'STOPPING',
  'STOPPED',
  'FAILED',
  'DESTROYED',
];

describe('canTransition', () => {
  it.each(HAPPY_PATH)('test_happy_path_transition_%s_to_%s_is_allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(ALL_STATUSES)('test_any_status_to_FAILED_is_allowed (%s)', (from) => {
    expect(canTransition(from, 'FAILED')).toBe(true);
  });

  it('test_FAILED_to_DESTROYED_is_allowed', () => {
    expect(canTransition('FAILED', 'DESTROYED')).toBe(true);
  });

  it('test_STOPPED_to_ACTIVE_direct_transition_is_rejected', () => {
    expect(canTransition('STOPPED', 'ACTIVE')).toBe(false);
  });

  it('test_CREATED_to_ACTIVE_skip_transition_is_rejected', () => {
    expect(canTransition('CREATED', 'ACTIVE')).toBe(false);
  });

  it('test_DESTROYED_to_anything_is_rejected', () => {
    for (const to of ALL_STATUSES) {
      if (to === 'DESTROYED') continue;
      expect(canTransition('DESTROYED', to)).toBe(false);
    }
  });
});

describe('assertTransition', () => {
  it('test_allowed_transition_does_not_throw', () => {
    expect(() => assertTransition('CREATED', 'RESOLVING')).not.toThrow();
  });

  it('test_disallowed_transition_throws_GaesupError_with_invalid_transition_code', () => {
    // I5: 정의 밖 lifecycle 전이는 GaesupError(GAESUP_INVALID_TRANSITION)을 던져야 한다.
    let caught: unknown;
    try {
      assertTransition('STOPPED', 'ACTIVE');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GaesupError);
    expect((caught as InstanceType<typeof GaesupError>).code).toBe('GAESUP_INVALID_TRANSITION');
  });
});
