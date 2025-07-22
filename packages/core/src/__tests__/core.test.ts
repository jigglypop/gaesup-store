import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GaesupCore } from '../index';

describe('GaesupCore', () => {
  const TEST_STORE_ID = 'test-store';
  
  beforeEach(async () => {
    // 각 테스트 전 초기화
    await GaesupCore.garbageCollect();
  });
  
  afterEach(async () => {
    // 각 테스트 후 정리
    try {
      await GaesupCore.cleanupStore(TEST_STORE_ID);
    } catch {}
  });

  describe('Store Creation', () => {
    it('should create a new store', async () => {
      const initialState = { count: 0, name: 'Test' };
      await GaesupCore.createStore(TEST_STORE_ID, initialState);
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual(initialState);
    });
    
    it('should throw error when creating duplicate store', async () => {
      await GaesupCore.createStore(TEST_STORE_ID, {});
      
      await expect(
        GaesupCore.createStore(TEST_STORE_ID, {})
      ).rejects.toThrow('already exists');
    });
    
    it('should handle complex initial state', async () => {
      const complexState = {
        user: {
          id: 1,
          profile: {
            name: 'Test User',
            settings: {
              theme: 'dark',
              notifications: true
            }
          }
        },
        data: Array(100).fill(0).map((_, i) => ({ id: i, value: Math.random() }))
      };
      
      await GaesupCore.createStore(TEST_STORE_ID, complexState);
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual(complexState);
    });
  });

  describe('State Updates', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { count: 0, items: [] });
    });
    
    it('should update state with SET action', async () => {
      const newState = { count: 5, items: [1, 2, 3] };
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', newState);
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual(newState);
    });
    
    it('should merge state with MERGE action', async () => {
      await GaesupCore.dispatch(TEST_STORE_ID, 'MERGE', { count: 10 });
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state.count).toBe(10);
      expect(state.items).toEqual([]);
    });
    
    it('should update nested value with UPDATE action', async () => {
      const initialState = {
        user: { name: 'John', age: 30 },
        settings: { theme: 'light' }
      };
      
      await GaesupCore.createStore('nested-test', initialState);
      await GaesupCore.dispatch('nested-test', 'UPDATE', {
        path: 'user.age',
        value: 31
      });
      
      const age = GaesupCore.select('nested-test', 'user.age');
      expect(age).toBe(31);
      
      await GaesupCore.cleanupStore('nested-test');
    });
    
    it('should delete nested value with DELETE action', async () => {
      const initialState = {
        user: { name: 'John', age: 30 },
        settings: { theme: 'light' }
      };
      
      await GaesupCore.createStore('delete-test', initialState);
      await GaesupCore.dispatch('delete-test', 'DELETE', 'user.age');
      
      const user = GaesupCore.select('delete-test', 'user');
      expect(user).toEqual({ name: 'John' });
      
      await GaesupCore.cleanupStore('delete-test');
    });
  });

  describe('State Selection', () => {
    const testState = {
      user: {
        id: 1,
        name: 'Test',
        profile: {
          age: 25,
          location: 'Seoul',
          preferences: {
            theme: 'dark',
            language: 'ko'
          }
        }
      },
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' }
      ]
    };
    
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, testState);
    });
    
    it('should select entire state with empty path', () => {
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual(testState);
    });
    
    it('should select nested values', () => {
      const theme = GaesupCore.select(TEST_STORE_ID, 'user.profile.preferences.theme');
      expect(theme).toBe('dark');
    });
    
    it('should select array elements', () => {
      const item = GaesupCore.select(TEST_STORE_ID, 'items.1');
      expect(item).toEqual({ id: 2, name: 'Item 2' });
    });
    
    it('should throw error for invalid path', () => {
      expect(() => {
        GaesupCore.select(TEST_STORE_ID, 'invalid.path.here');
      }).toThrow('not found');
    });
  });

  describe('Subscriptions', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { count: 0 });
    });
    
    it('should subscribe to state changes', async () => {
      const callback = vi.fn();
      const callbackId = 'test-callback';
      
      GaesupCore.registerCallback(callbackId, callback);
      const subId = GaesupCore.subscribe(TEST_STORE_ID, '', callbackId);
      
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: 1 });
      
      expect(callback).toHaveBeenCalled();
      
      GaesupCore.unsubscribe(subId);
      GaesupCore.unregisterCallback(callbackId);
    });
    
    it('should unsubscribe correctly', async () => {
      const callback = vi.fn();
      const callbackId = 'test-callback-2';
      
      GaesupCore.registerCallback(callbackId, callback);
      const subId = GaesupCore.subscribe(TEST_STORE_ID, '', callbackId);
      
      GaesupCore.unsubscribe(subId);
      GaesupCore.unregisterCallback(callbackId);
      
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: 2 });
      
      expect(callback).not.toHaveBeenCalled();
    });
    
    it('should handle multiple subscriptions', async () => {
      const callbacks = Array(10).fill(0).map((_, i) => ({
        fn: vi.fn(),
        id: `callback-${i}`
      }));
      
      const subIds = callbacks.map(({ fn, id }) => {
        GaesupCore.registerCallback(id, fn);
        return GaesupCore.subscribe(TEST_STORE_ID, '', id);
      });
      
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: 10 });
      
      callbacks.forEach(({ fn }) => {
        expect(fn).toHaveBeenCalledTimes(1);
      });
      
      // 정리
      subIds.forEach(id => GaesupCore.unsubscribe(id));
      callbacks.forEach(({ id }) => GaesupCore.unregisterCallback(id));
    });
  });

  describe('Batch Updates', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { a: 1, b: 2, c: 3 });
    });
    
    it('should handle batch updates', async () => {
      const batch = GaesupCore.createBatchUpdate(TEST_STORE_ID);
      
      batch.addUpdate('MERGE', { a: 10 });
      batch.addUpdate('MERGE', { b: 20 });
      batch.addUpdate('MERGE', { c: 30 });
      
      await batch.execute();
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual({ a: 10, b: 20, c: 30 });
    });
    
    it('should batch multiple action types', async () => {
      const batch = GaesupCore.createBatchUpdate(TEST_STORE_ID);
      
      batch.addUpdate('SET', { x: 1, y: 2 });
      batch.addUpdate('MERGE', { z: 3 });
      batch.addUpdate('UPDATE', { path: 'x', value: 10 });
      
      await batch.execute();
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual({ x: 10, y: 2, z: 3 });
    });
  });

  describe('Snapshots', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { count: 0, name: 'Test' });
    });
    
    it('should create and restore snapshot', async () => {
      // 초기 상태 스냅샷
      const snapshot1 = await GaesupCore.createSnapshot(TEST_STORE_ID);
      
      // 상태 변경
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: 10, name: 'Updated' });
      
      // 두 번째 스냅샷
      const snapshot2 = await GaesupCore.createSnapshot(TEST_STORE_ID);
      
      // 더 변경
      await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: 20, name: 'Final' });
      
      // 첫 번째 스냅샷 복원
      await GaesupCore.restoreSnapshot(TEST_STORE_ID, snapshot1);
      let state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual({ count: 0, name: 'Test' });
      
      // 두 번째 스냅샷 복원
      await GaesupCore.restoreSnapshot(TEST_STORE_ID, snapshot2);
      state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state).toEqual({ count: 10, name: 'Updated' });
    });
    
    it('should handle multiple snapshots', async () => {
      const snapshots: string[] = [];
      
      // 여러 스냅샷 생성
      for (let i = 0; i < 10; i++) {
        await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: i });
        snapshots.push(await GaesupCore.createSnapshot(TEST_STORE_ID));
      }
      
      // 랜덤 스냅샷 복원
      const randomIndex = Math.floor(Math.random() * snapshots.length);
      await GaesupCore.restoreSnapshot(TEST_STORE_ID, snapshots[randomIndex]);
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      expect(state.count).toBe(randomIndex);
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { count: 0 });
    });
    
    it('should track metrics', async () => {
      // 여러 작업 수행
      for (let i = 0; i < 100; i++) {
        await GaesupCore.dispatch(TEST_STORE_ID, 'SET', { count: i });
        GaesupCore.select(TEST_STORE_ID, 'count');
      }
      
      const metrics = await GaesupCore.getMetrics(TEST_STORE_ID);
      
      expect(metrics.total_dispatches).toBeGreaterThan(0);
      expect(metrics.total_selects).toBeGreaterThan(0);
      expect(metrics.avg_dispatch_time).toBeGreaterThan(0);
      expect(metrics.memory_usage).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle store not found errors', () => {
      expect(() => {
        GaesupCore.select('non-existent-store', '');
      }).toThrow('not found');
    });
    
    it('should handle invalid action types gracefully', async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { count: 0 });
      
      // 알 수 없는 액션 타입은 무시됨
      await expect(
        GaesupCore.dispatch(TEST_STORE_ID, 'UNKNOWN_ACTION', {})
      ).resolves.not.toThrow();
    });
  });

  describe('Memory Management', () => {
    it('should cleanup stores properly', async () => {
      // 여러 스토어 생성
      const storeIds = Array(10).fill(0).map((_, i) => `store-${i}`);
      
      for (const id of storeIds) {
        await GaesupCore.createStore(id, { data: 'test' });
      }
      
      // 모든 스토어 정리
      for (const id of storeIds) {
        await GaesupCore.cleanupStore(id);
      }
      
      // 정리된 스토어 접근 시도
      for (const id of storeIds) {
        expect(() => {
          GaesupCore.select(id, '');
        }).toThrow();
      }
    });
    
    it('should handle garbage collection', async () => {
      // 가비지 컬렉션은 에러 없이 실행되어야 함
      await expect(GaesupCore.garbageCollect()).resolves.not.toThrow();
    });
  });

  describe('Concurrent Operations', () => {
    beforeEach(async () => {
      await GaesupCore.createStore(TEST_STORE_ID, { counter: 0 });
    });
    
    it('should handle concurrent updates', async () => {
      const promises = Array(100).fill(0).map(async (_, i) => {
        await GaesupCore.dispatch(TEST_STORE_ID, 'MERGE', { [`field${i}`]: i });
      });
      
      await Promise.all(promises);
      
      const state = GaesupCore.select(TEST_STORE_ID, '');
      
      // 모든 필드가 설정되어야 함
      for (let i = 0; i < 100; i++) {
        expect(state[`field${i}`]).toBe(i);
      }
    });
    
    it('should handle concurrent reads', async () => {
      const promises = Array(1000).fill(0).map(async () => {
        return GaesupCore.select(TEST_STORE_ID, 'counter');
      });
      
      const results = await Promise.all(promises);
      
      // 모든 읽기가 동일한 값을 반환해야 함
      results.forEach(result => {
        expect(result).toBe(0);
      });
    });
  });
}); 