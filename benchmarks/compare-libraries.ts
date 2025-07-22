import { GaesupCore } from '@gaesup-state/core';
import { createStore as createReduxStore, combineReducers } from 'redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { create } from 'zustand';
import { observable, action, makeAutoObservable } from 'mobx';
import { proxy, subscribe as valtioSubscribe } from 'valtio';
import { atom, createStore as createJotaiStore } from 'jotai';
import { createSignal, createRoot } from 'solid-js';

// 벤치마크 설정
const ITERATIONS = {
  simple: 10000,
  complex: 1000,
  read: 100000,
  batch: 1000,
  subscribers: 1000
};

// 색상 코드
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// 결과 저장
const results: Record<string, Record<string, number>> = {};

// 벤치마크 클래스
class LibraryBenchmark {
  private name: string;
  
  constructor(name: string) {
    this.name = name;
    results[name] = {};
  }
  
  async run(testName: string, iterations: number, fn: () => void | Promise<void>): Promise<number> {
    console.log(`  ${colors.cyan}Running ${testName}...${colors.reset}`);
    
    // Warm up
    for (let i = 0; i < Math.min(100, iterations / 10); i++) {
      await fn();
    }
    
    // 실제 벤치마크
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
    
    const end = performance.now();
    const totalTime = end - start;
    const avgTime = totalTime / iterations;
    
    results[this.name][testName] = avgTime;
    
    console.log(`    Time: ${totalTime.toFixed(2)}ms (${avgTime.toFixed(4)}ms per op)`);
    
    return avgTime;
  }
}

// 테스트 데이터
const simpleData = { count: 0 };
const complexData = {
  user: {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    profile: {
      age: 25,
      location: 'Seoul',
      preferences: {
        theme: 'dark',
        language: 'ko',
        notifications: true
      }
    }
  },
  posts: Array(100).fill(0).map((_, i) => ({
    id: i,
    title: `Post ${i}`,
    content: `Content ${i}`,
    likes: Math.floor(Math.random() * 100),
    comments: []
  })),
  settings: {
    privacy: 'public',
    autoSave: true,
    syncEnabled: false
  }
};

async function runAllBenchmarks() {
  console.log(`${colors.yellow}🏁 State Management Library Performance Comparison${colors.reset}`);
  console.log('='.repeat(60));
  
  // 1. Gaesup-State
  console.log(`\n${colors.green}📦 Gaesup-State (WASM)${colors.reset}`);
  const gaesup = new LibraryBenchmark('Gaesup-State');
  
  await GaesupCore.createStore('bench', simpleData);
  
  await gaesup.run('Simple Update', ITERATIONS.simple, async () => {
    const current = GaesupCore.select('bench', 'count');
    await GaesupCore.dispatch('bench', 'SET', { count: current + 1 });
  });
  
  await gaesup.run('Complex Update', ITERATIONS.complex, async () => {
    await GaesupCore.dispatch('bench', 'SET', complexData);
  });
  
  await gaesup.run('State Read', ITERATIONS.read, () => {
    GaesupCore.select('bench', 'user.profile.preferences.theme');
  });
  
  await gaesup.run('Batch Update', ITERATIONS.batch, async () => {
    const batch = GaesupCore.createBatchUpdate('bench');
    for (let i = 0; i < 10; i++) {
      batch.addUpdate('MERGE', { [`item${i}`]: i });
    }
    await batch.execute();
  });
  
  // 2. Redux
  console.log(`\n${colors.blue}📦 Redux${colors.reset}`);
  const redux = new LibraryBenchmark('Redux');
  
  const reduxReducer = (state = simpleData, action: any) => {
    switch (action.type) {
      case 'SET':
        return action.payload;
      case 'INCREMENT':
        return { ...state, count: state.count + 1 };
      default:
        return state;
    }
  };
  
  const reduxStore = createReduxStore(reduxReducer);
  
  await redux.run('Simple Update', ITERATIONS.simple, () => {
    reduxStore.dispatch({ type: 'INCREMENT' });
  });
  
  await redux.run('Complex Update', ITERATIONS.complex, () => {
    reduxStore.dispatch({ type: 'SET', payload: complexData });
  });
  
  await redux.run('State Read', ITERATIONS.read, () => {
    const state = reduxStore.getState() as any;
    const theme = state.user?.profile?.preferences?.theme;
  });
  
  await redux.run('Batch Update', ITERATIONS.batch, () => {
    for (let i = 0; i < 10; i++) {
      reduxStore.dispatch({ type: 'SET', payload: { [`item${i}`]: i } });
    }
  });
  
  // 3. Redux Toolkit
  console.log(`\n${colors.blue}📦 Redux Toolkit${colors.reset}`);
  const rtk = new LibraryBenchmark('Redux Toolkit');
  
  const rtkSlice = createSlice({
    name: 'bench',
    initialState: simpleData,
    reducers: {
      increment: (state) => {
        state.count += 1;
      },
      set: (state, action) => {
        return action.payload;
      }
    }
  });
  
  const rtkStore = configureStore({
    reducer: rtkSlice.reducer
  });
  
  await rtk.run('Simple Update', ITERATIONS.simple, () => {
    rtkStore.dispatch(rtkSlice.actions.increment());
  });
  
  await rtk.run('Complex Update', ITERATIONS.complex, () => {
    rtkStore.dispatch(rtkSlice.actions.set(complexData));
  });
  
  await rtk.run('State Read', ITERATIONS.read, () => {
    const state = rtkStore.getState() as any;
    const theme = state.user?.profile?.preferences?.theme;
  });
  
  // 4. Zustand
  console.log(`\n${colors.magenta}📦 Zustand${colors.reset}`);
  const zustand = new LibraryBenchmark('Zustand');
  
  const useStore = create((set, get) => ({
    ...simpleData,
    increment: () => set((state: any) => ({ count: state.count + 1 })),
    setData: (data: any) => set(data),
    getData: () => get()
  }));
  
  await zustand.run('Simple Update', ITERATIONS.simple, () => {
    useStore.getState().increment();
  });
  
  await zustand.run('Complex Update', ITERATIONS.complex, () => {
    useStore.getState().setData(complexData);
  });
  
  await zustand.run('State Read', ITERATIONS.read, () => {
    const state = useStore.getState() as any;
    const theme = state.user?.profile?.preferences?.theme;
  });
  
  // 5. MobX
  console.log(`\n${colors.yellow}📦 MobX${colors.reset}`);
  const mobx = new LibraryBenchmark('MobX');
  
  class MobXStore {
    count = 0;
    data: any = simpleData;
    
    constructor() {
      makeAutoObservable(this);
    }
    
    increment() {
      this.count++;
    }
    
    setData(data: any) {
      this.data = data;
    }
  }
  
  const mobxStore = new MobXStore();
  
  await mobx.run('Simple Update', ITERATIONS.simple, () => {
    mobxStore.increment();
  });
  
  await mobx.run('Complex Update', ITERATIONS.complex, () => {
    mobxStore.setData(complexData);
  });
  
  await mobx.run('State Read', ITERATIONS.read, () => {
    const theme = mobxStore.data.user?.profile?.preferences?.theme;
  });
  
  // 6. Valtio
  console.log(`\n${colors.cyan}📦 Valtio${colors.reset}`);
  const valtio = new LibraryBenchmark('Valtio');
  
  const valtioState = proxy({ ...simpleData });
  
  await valtio.run('Simple Update', ITERATIONS.simple, () => {
    valtioState.count++;
  });
  
  await valtio.run('Complex Update', ITERATIONS.complex, () => {
    Object.assign(valtioState, complexData);
  });
  
  await valtio.run('State Read', ITERATIONS.read, () => {
    const state = valtioState as any;
    const theme = state.user?.profile?.preferences?.theme;
  });
  
  // 7. Jotai
  console.log(`\n${colors.red}📦 Jotai${colors.reset}`);
  const jotai = new LibraryBenchmark('Jotai');
  
  const countAtom = atom(0);
  const dataAtom = atom(simpleData);
  const jotaiStore = createJotaiStore();
  
  await jotai.run('Simple Update', ITERATIONS.simple, () => {
    const current = jotaiStore.get(countAtom);
    jotaiStore.set(countAtom, current + 1);
  });
  
  await jotai.run('Complex Update', ITERATIONS.complex, () => {
    jotaiStore.set(dataAtom, complexData);
  });
  
  await jotai.run('State Read', ITERATIONS.read, () => {
    const data = jotaiStore.get(dataAtom) as any;
    const theme = data.user?.profile?.preferences?.theme;
  });
  
  // 결과 출력
  console.log(`\n${colors.yellow}📊 Performance Summary (ms per operation)${colors.reset}`);
  console.log('='.repeat(80));
  
  const libraries = Object.keys(results);
  const tests = Object.keys(results[libraries[0]]);
  
  // 헤더
  console.log('Library'.padEnd(20), ...tests.map(t => t.padEnd(15)));
  console.log('-'.repeat(20 + tests.length * 15));
  
  // 각 라이브러리 결과
  libraries.forEach(lib => {
    const values = tests.map(test => {
      const value = results[lib][test];
      const formatted = value.toFixed(4);
      
      // 최고 성능 표시
      const allValues = libraries.map(l => results[l][test]);
      const best = Math.min(...allValues);
      
      if (value === best) {
        return `${colors.green}${formatted}${colors.reset}`;
      }
      return formatted;
    });
    
    console.log(lib.padEnd(20), ...values.map((v, i) => v.padEnd(15 + 10))); // 색상 코드 길이 보정
  });
  
  // 상대 성능 비교
  console.log(`\n${colors.yellow}📈 Relative Performance (vs Redux)${colors.reset}`);
  console.log('='.repeat(60));
  
  const reduxResults = results['Redux'];
  
  libraries.filter(lib => lib !== 'Redux').forEach(lib => {
    console.log(`\n${lib}:`);
    tests.forEach(test => {
      const ratio = results[lib][test] / reduxResults[test];
      const percentage = ((1 - ratio) * 100).toFixed(1);
      const faster = ratio < 1;
      
      console.log(`  ${test}: ${faster ? colors.green : colors.red}${
        faster ? percentage + '% faster' : Math.abs(parseFloat(percentage)) + '% slower'
      }${colors.reset}`);
    });
  });
  
  // 메모리 사용량 비교
  console.log(`\n${colors.yellow}💾 Memory Usage Comparison${colors.reset}`);
  console.log('='.repeat(60));
  
  // Gaesup-State 메모리
  const gaesupMetrics = await GaesupCore.getMetrics('bench');
  console.log(`Gaesup-State: ${(gaesupMetrics.memory_usage / 1024).toFixed(2)}KB`);
  
  // 다른 라이브러리들은 추정치
  const dataSize = JSON.stringify(complexData).length;
  console.log(`Others (estimated): ${(dataSize / 1024).toFixed(2)}KB`);
  
  // 정리
  await GaesupCore.cleanupStore('bench');
}

// 실행
if (require.main === module) {
  runAllBenchmarks()
    .then(() => {
      console.log(`\n${colors.green}✅ Benchmark completed!${colors.reset}`);
      process.exit(0);
    })
    .catch(err => {
      console.error(`${colors.red}❌ Benchmark failed:${colors.reset}`, err);
      process.exit(1);
    });
}

export { runAllBenchmarks }; 