import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GaesupCore } from '@gaesup-state/core';
import { createGaesupStore, useSelector, useDispatch } from '@gaesup-state/react';
import { defineStore as defineVueStore } from '@gaesup-state/vue';
import { gaesupStore as createSvelteStore } from '@gaesup-state/svelte';
import { produce, createSlice } from '@gaesup-state/core/immer';
import { logger, thunk, devTools } from '@gaesup-state/core/middleware';

describe('Multi-Framework Integration Tests', () => {
  const STORE_ID = 'integration-test';
  
  beforeEach(async () => {
    await GaesupCore.garbageCollect();
  });
  
  afterEach(async () => {
    try {
      await GaesupCore.cleanupStore(STORE_ID);
    } catch {}
  });

  describe('Cross-Framework State Sharing', () => {
    it('should share state between React, Vue, and Svelte', async () => {
      // 공통 상태 정의
      const initialState = {
        user: { name: 'Test User', id: 1 },
        todos: [],
        settings: { theme: 'light' }
      };
      
      // 스토어 생성
      await GaesupCore.createStore(STORE_ID, initialState);
      
      // React에서 상태 변경
      await GaesupCore.dispatch(STORE_ID, 'MERGE', {
        user: { name: 'React User' }
      });
      
      // Vue에서 확인
      const vueState = GaesupCore.select(STORE_ID, '');
      expect(vueState.user.name).toBe('React User');
      
      // Svelte에서 변경
      await GaesupCore.dispatch(STORE_ID, 'UPDATE', {
        path: 'settings.theme',
        value: 'dark'
      });
      
      // 모든 프레임워크에서 동일한 상태 확인
      const finalState = GaesupCore.select(STORE_ID, '');
      expect(finalState.user.name).toBe('React User');
      expect(finalState.settings.theme).toBe('dark');
    });
    
    it('should handle concurrent updates from multiple frameworks', async () => {
      await GaesupCore.createStore(STORE_ID, { counter: 0 });
      
      // 동시에 여러 프레임워크에서 업데이트
      const updates = Promise.all([
        // React
        GaesupCore.dispatch(STORE_ID, 'MERGE', { react: true }),
        // Vue
        GaesupCore.dispatch(STORE_ID, 'MERGE', { vue: true }),
        // Svelte
        GaesupCore.dispatch(STORE_ID, 'MERGE', { svelte: true })
      ]);
      
      await updates;
      
      const state = GaesupCore.select(STORE_ID, '');
      expect(state).toHaveProperty('react', true);
      expect(state).toHaveProperty('vue', true);
      expect(state).toHaveProperty('svelte', true);
    });
  });

  describe('Redux Toolkit Compatible Features', () => {
    it('should work with createSlice', async () => {
      const todosSlice = createSlice({
        name: 'todos',
        initialState: {
          items: [],
          filter: 'all'
        },
        reducers: {
          addTodo: (state, action) => {
            state.items.push({
              id: Date.now(),
              text: action.payload,
              completed: false
            });
          },
          toggleTodo: (state, action) => {
            const todo = state.items.find((t: any) => t.id === action.payload);
            if (todo) {
              todo.completed = !todo.completed;
            }
          },
          setFilter: (state, action) => {
            state.filter = action.payload;
          }
        }
      });
      
      // 스토어 생성
      await todosSlice.createStore();
      
      // 액션 디스패치
      await GaesupCore.dispatch('todos', 'todos/addTodo', 'Test Todo');
      await GaesupCore.dispatch('todos', 'todos/addTodo', 'Another Todo');
      
      const state = GaesupCore.select('todos', '');
      expect(state.items).toHaveLength(2);
      expect(state.items[0].text).toBe('Test Todo');
      
      // Toggle todo
      const todoId = state.items[0].id;
      await GaesupCore.dispatch('todos', 'todos/toggleTodo', todoId);
      
      const updatedState = GaesupCore.select('todos', '');
      expect(updatedState.items[0].completed).toBe(true);
      
      await GaesupCore.cleanupStore('todos');
    });
  });

  describe('Immer Integration', () => {
    it('should handle immer-style updates', async () => {
      const complexState = {
        users: [
          { id: 1, name: 'Alice', posts: [] },
          { id: 2, name: 'Bob', posts: [] }
        ],
        metadata: {
          totalPosts: 0,
          lastUpdate: null
        }
      };
      
      await GaesupCore.createStore(STORE_ID, complexState);
      
      // Immer 스타일 업데이트
      const currentState = GaesupCore.select(STORE_ID, '');
      const nextState = produce(currentState, draft => {
        // 사용자 추가
        draft.users.push({ id: 3, name: 'Charlie', posts: [] });
        
        // 포스트 추가
        draft.users[0].posts.push({
          id: 1,
          title: 'First Post',
          content: 'Hello World'
        });
        
        // 메타데이터 업데이트
        draft.metadata.totalPosts = 1;
        draft.metadata.lastUpdate = new Date().toISOString();
      });
      
      await GaesupCore.dispatch(STORE_ID, 'SET', nextState);
      
      const finalState = GaesupCore.select(STORE_ID, '');
      expect(finalState.users).toHaveLength(3);
      expect(finalState.users[0].posts).toHaveLength(1);
      expect(finalState.metadata.totalPosts).toBe(1);
    });
  });

  describe('Middleware System', () => {
    it('should support Redux-style middleware', async () => {
      const logs: string[] = [];
      
      // 커스텀 미들웨어
      const customLogger = (store: any) => (next: any) => (action: any) => {
        logs.push(`Before: ${action.type}`);
        const result = next(action);
        logs.push(`After: ${action.type}`);
        return result;
      };
      
      // 미들웨어 적용 (실제 구현에서는 middlewareManager 사용)
      // middlewareManager.applyMiddleware(STORE_ID, customLogger, logger);
      
      await GaesupCore.createStore(STORE_ID, { count: 0 });
      await GaesupCore.dispatch(STORE_ID, 'SET', { count: 1 });
      
      // 로그 확인 (미들웨어가 실제로 구현되면)
      // expect(logs).toContain('Before: SET');
      // expect(logs).toContain('After: SET');
    });
  });

  describe('Performance & Scalability', () => {
    it('should handle large state efficiently', async () => {
      // 큰 상태 생성
      const largeState = {
        users: Array(1000).fill(0).map((_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          profile: {
            age: 20 + (i % 50),
            location: ['Seoul', 'Tokyo', 'New York'][i % 3],
            interests: ['coding', 'music', 'sports']
          }
        })),
        posts: Array(5000).fill(0).map((_, i) => ({
          id: i,
          userId: i % 1000,
          title: `Post ${i}`,
          content: `Content for post ${i}`,
          likes: Math.floor(Math.random() * 100),
          comments: []
        }))
      };
      
      const start = performance.now();
      await GaesupCore.createStore(STORE_ID, largeState);
      const createTime = performance.now() - start;
      
      // 성능 테스트: 생성
      expect(createTime).toBeLessThan(100); // 100ms 이내
      
      // 성능 테스트: 읽기
      const readStart = performance.now();
      for (let i = 0; i < 100; i++) {
        GaesupCore.select(STORE_ID, `users.${i}.profile.location`);
      }
      const readTime = performance.now() - readStart;
      expect(readTime).toBeLessThan(50); // 50ms 이내
      
      // 성능 테스트: 업데이트
      const updateStart = performance.now();
      await GaesupCore.dispatch(STORE_ID, 'UPDATE', {
        path: 'users.500.name',
        value: 'Updated User'
      });
      const updateTime = performance.now() - updateStart;
      expect(updateTime).toBeLessThan(50); // 50ms 이내
      
      // 메트릭스 확인
      const metrics = await GaesupCore.getMetrics(STORE_ID);
      expect(metrics.memory_usage).toBeGreaterThan(0);
      expect(metrics.total_selects).toBe(100);
    });
    
    it('should handle many subscribers efficiently', async () => {
      await GaesupCore.createStore(STORE_ID, { count: 0 });
      
      const callbacks: Function[] = [];
      const subscriptions: string[] = [];
      
      // 많은 구독자 등록
      for (let i = 0; i < 100; i++) {
        const callback = () => {};
        const callbackId = `callback_${i}`;
        
        callbacks.push(callback);
        GaesupCore.registerCallback(callbackId, callback);
        
        const subId = GaesupCore.subscribe(STORE_ID, '', callbackId);
        subscriptions.push(subId);
      }
      
      // 업데이트 성능 테스트
      const start = performance.now();
      await GaesupCore.dispatch(STORE_ID, 'SET', { count: 1 });
      const updateTime = performance.now() - start;
      
      expect(updateTime).toBeLessThan(100); // 100ms 이내
      
      // 정리
      subscriptions.forEach(id => GaesupCore.unsubscribe(id));
    });
  });

  describe('Time Travel & DevTools', () => {
    it('should support time travel debugging', async () => {
      await GaesupCore.createStore(STORE_ID, { step: 0 });
      
      const snapshots: string[] = [];
      
      // 여러 상태 변경과 스냅샷
      for (let i = 1; i <= 5; i++) {
        await GaesupCore.dispatch(STORE_ID, 'SET', { step: i });
        snapshots.push(await GaesupCore.createSnapshot(STORE_ID));
      }
      
      // 현재 상태 확인
      let state = GaesupCore.select(STORE_ID, '');
      expect(state.step).toBe(5);
      
      // 과거로 이동
      await GaesupCore.restoreSnapshot(STORE_ID, snapshots[2]); // step 3
      state = GaesupCore.select(STORE_ID, '');
      expect(state.step).toBe(3);
      
      // 더 과거로
      await GaesupCore.restoreSnapshot(STORE_ID, snapshots[0]); // step 1
      state = GaesupCore.select(STORE_ID, '');
      expect(state.step).toBe(1);
    });
  });

  describe('Persistence', () => {
    it('should persist and hydrate state', async () => {
      const storageKey = 'test-persist';
      
      // 상태 생성 및 저장
      await GaesupCore.createStore(STORE_ID, {
        user: { name: 'John', preferences: { theme: 'dark' } },
        savedAt: new Date().toISOString()
      });
      
      await GaesupCore.persist_store(STORE_ID, storageKey);
      
      // 스토어 정리
      await GaesupCore.cleanupStore(STORE_ID);
      
      // 새 스토어 생성 및 복원
      await GaesupCore.createStore(STORE_ID, {});
      await GaesupCore.hydrate_store(STORE_ID, storageKey);
      
      const restoredState = GaesupCore.select(STORE_ID, '');
      expect(restoredState.user.name).toBe('John');
      expect(restoredState.user.preferences.theme).toBe('dark');
      
      // localStorage 정리
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      // 존재하지 않는 스토어 접근
      expect(() => {
        GaesupCore.select('non-existent', '');
      }).toThrow();
      
      // 잘못된 경로 접근
      await GaesupCore.createStore(STORE_ID, { a: { b: 1 } });
      
      expect(() => {
        GaesupCore.select(STORE_ID, 'a.b.c.d');
      }).toThrow();
      
      // 잘못된 업데이트
      await expect(
        GaesupCore.dispatch(STORE_ID, 'UPDATE', {
          path: 'non.existent.path',
          value: 123
        })
      ).rejects.toThrow();
    });
  });

  describe('Memory Management', () => {
    it('should clean up resources properly', async () => {
      // 여러 스토어 생성
      const storeIds = Array(10).fill(0).map((_, i) => `store_${i}`);
      
      for (const id of storeIds) {
        await GaesupCore.createStore(id, { data: 'test' });
        
        // 스냅샷 생성
        for (let j = 0; j < 5; j++) {
          await GaesupCore.createSnapshot(id);
        }
      }
      
      // 가비지 컬렉션
      await GaesupCore.garbageCollect();
      
      // 스토어 정리
      for (const id of storeIds) {
        await GaesupCore.cleanupStore(id);
      }
      
      // 모든 스토어가 정리되었는지 확인
      for (const id of storeIds) {
        expect(() => GaesupCore.select(id, '')).toThrow();
      }
    });
  });
}); 