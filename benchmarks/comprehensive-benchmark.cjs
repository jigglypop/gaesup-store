console.log('🚀 Gaesup-State 종합 성능 벤치마크\n');

// 벤치마크 유틸리티
class PerformanceBenchmark {
  constructor(name) {
    this.name = name;
  }

  async run(fn, iterations) {
    // Warm-up
    for (let i = 0; i < 100; i++) {
      await fn();
    }
    
    // GC 강제 실행
    if (global.gc) {
      global.gc();
    }
    
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
    const end = performance.now();
    
    const totalTime = end - start;
    const avgTime = totalTime / iterations;
    const opsPerSecond = 1000 / avgTime;
    
    return {
      name: this.name,
      iterations,
      totalTime,
      avgTime,
      opsPerSecond
    };
  }
}

// 라이브러리 임포트
const { createStore } = require('redux');
const { configureStore, createSlice } = require('@reduxjs/toolkit');
const { createStore: createZustandStore } = require('zustand/vanilla');
const { createStore: createJotaiStore, atom } = require('jotai/vanilla');
const { produce } = require('immer');

// 테스트 데이터 생성기
const generateData = (size) => {
  const data = {};
  for (let i = 0; i < size; i++) {
    data[`key_${i}`] = {
      value: Math.random(),
      nested: {
        id: `id_${i}`,
        timestamp: Date.now(),
        metadata: {
          count: i,
          active: true
        }
      }
    };
  }
  return data;
};

// --- 라이브러리 구현 ---

// 1. Gaesup-State (불변성 유지하는 진짜 구현)
class GaesupState {
  constructor() {
    this.state = {};
    this.pathCache = new Map();
  }
  
  dispatch(path, value) {
    // 경로 캐시 활용
    let parts = this.pathCache.get(path);
    if (!parts) {
      parts = path.split('.');
      this.pathCache.set(path, parts);
    }
    
    // 불변성 유지! (실제 구현과 동일)
    const newState = JSON.parse(JSON.stringify(this.state));
    let current = newState;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    
    this.state = newState;
    return newState;
  }
  
  getState() {
    return this.state;
  }
}

// 2. Redux (기본)
const createReduxStore = (initialState) => {
  const reducer = (state = initialState, action) => {
    switch (action.type) {
      case 'UPDATE':
        return produce(state, draft => {
          let current = draft;
          const parts = action.path.split('.');
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
              current[parts[i]] = {};
            }
            current = current[parts[i]];
          }
          current[parts[parts.length - 1]] = action.value;
        });
      default:
        return state;
    }
  };
  
  return createStore(reducer);
};

// 3. Redux Toolkit
const createReduxToolkitStore = (initialState) => {
  const slice = createSlice({
    name: 'data',
    initialState,
    reducers: {
      updatePath: (state, action) => {
        const { path, value } = action.payload;
        let current = state;
        const parts = path.split('.');
        
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
      }
    }
  });
  
  const store = configureStore({
    reducer: slice.reducer
  });
  
  return { store, actions: slice.actions };
};

// 4. Zustand
const createZustandBenchStore = (initialState) => {
  return createZustandStore((set, get) => ({
    ...initialState,
    updatePath: (path, value) => {
      set(produce(state => {
        let current = state;
        const parts = path.split('.');
        
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
      }));
    }
  }));
};

// 5. Jotai
const createJotaiBenchStore = (initialState) => {
  const store = createJotaiStore();
  const dataAtom = atom(initialState);
  
  return {
    store,
    dataAtom,
    updatePath: (path, value) => {
      const current = store.get(dataAtom);
      const updated = produce(current, draft => {
        let target = draft;
        const parts = path.split('.');
        
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]]) {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
      });
      
      store.set(dataAtom, updated);
    },
    getState: () => store.get(dataAtom)
  };
};

// --- 벤치마크 시나리오 ---
const scenarios = {
  "소량 (10개)": { size: 10, iterations: 10000 },
  "중량 (100개)": { size: 100, iterations: 5000 },
  "대량 (1000개)": { size: 1000, iterations: 1000 },
  "초대량 (10000개)": { size: 10000, iterations: 100 }
};

async function runAllBenchmarks() {
  const results = {};

  for (const [scenarioName, config] of Object.entries(scenarios)) {
    console.log(`\n📊 ${scenarioName} 시나리오 테스트 중...`);
    const data = generateData(config.size);
    const testPath = `key_${Math.floor(config.size / 2)}.nested.metadata.count`;
    
    results[scenarioName] = {};

    // 1. Gaesup-State
    console.log('  - Gaesup-State 테스트...');
    const gaesup = new GaesupState();
    gaesup.state = JSON.parse(JSON.stringify(data));
    const gaesupBench = new PerformanceBenchmark('Gaesup-State');
    results[scenarioName].gaesup = await gaesupBench.run(() => {
      gaesup.dispatch(testPath, Math.random());
    }, config.iterations);

    // 2. Redux
    console.log('  - Redux 테스트...');
    const redux = createReduxStore(JSON.parse(JSON.stringify(data)));
    const reduxBench = new PerformanceBenchmark('Redux');
    results[scenarioName].redux = await reduxBench.run(() => {
      redux.dispatch({ type: 'UPDATE', path: testPath, value: Math.random() });
    }, config.iterations);

    // 3. Redux Toolkit
    console.log('  - Redux Toolkit 테스트...');
    const rtk = createReduxToolkitStore(JSON.parse(JSON.stringify(data)));
    const rtkBench = new PerformanceBenchmark('Redux Toolkit');
    results[scenarioName].rtk = await rtkBench.run(() => {
      rtk.store.dispatch(rtk.actions.updatePath({ path: testPath, value: Math.random() }));
    }, config.iterations);

    // 4. Zustand
    console.log('  - Zustand 테스트...');
    const zustand = createZustandBenchStore(JSON.parse(JSON.stringify(data)));
    const zustandBench = new PerformanceBenchmark('Zustand');
    results[scenarioName].zustand = await zustandBench.run(() => {
      zustand.getState().updatePath(testPath, Math.random());
    }, config.iterations);
    
    // 5. Jotai
    console.log('  - Jotai 테스트...');
    const jotai = createJotaiBenchStore(JSON.parse(JSON.stringify(data)));
    const jotaiBench = new PerformanceBenchmark('Jotai');
    results[scenarioName].jotai = await jotaiBench.run(() => {
      jotai.updatePath(testPath, Math.random());
    }, config.iterations);
  }

  // 결과 출력
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 종합 벤치마크 결과');
  console.log('='.repeat(80));
  
  for (const [scenarioName, libs] of Object.entries(results)) {
    console.log(`\n📈 ${scenarioName}`);
    console.log('-'.repeat(80));
    console.log(
      '라이브러리'.padEnd(20) + 
      '| ops/sec'.padStart(15) + 
      '| 평균 시간 (μs)'.padStart(18) + 
      '| Redux 대비'.padStart(15) +
      '| 순위'.padStart(8)
    );
    console.log('-'.repeat(80));
    
    const reduxOps = libs.redux.opsPerSecond;
    
    // 성능 순으로 정렬
    const sorted = Object.entries(libs).sort((a, b) => b[1].opsPerSecond - a[1].opsPerSecond);
    
    sorted.forEach(([libName, result], index) => {
      const speedup = (result.opsPerSecond / reduxOps).toFixed(2) + 'x';
      console.log(
        result.name.padEnd(20) + 
        `| ${result.opsPerSecond.toFixed(0).padStart(14)}` + 
        `| ${(result.avgTime * 1000).toFixed(2).padStart(17)}` + 
        `| ${speedup.padStart(14)}` +
        `| ${(index + 1).toString().padStart(7)}`
      );
    });
  }
  
  // 종합 분석
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 종합 분석');
  console.log('='.repeat(80));
  
  const avgSpeedups = {};
  Object.keys(results[Object.keys(results)[0]]).forEach(lib => {
    let totalSpeedup = 0;
    let count = 0;
    
    Object.values(results).forEach(scenario => {
      const reduxOps = scenario.redux.opsPerSecond;
      const libOps = scenario[lib].opsPerSecond;
      totalSpeedup += libOps / reduxOps;
      count++;
    });
    
    avgSpeedups[lib] = totalSpeedup / count;
  });
  
  console.log('\n평균 성능 (Redux 대비):');
  Object.entries(avgSpeedups)
    .sort((a, b) => b[1] - a[1])
    .forEach(([lib, speedup]) => {
      const libName = results[Object.keys(results)[0]][lib].name;
      console.log(`  ${libName.padEnd(20)}: ${speedup.toFixed(2)}x`);
    });
  
  console.log('\n✅ 종합 벤치마크 완료!');
}

// 실행
runAllBenchmarks().catch(console.error); 