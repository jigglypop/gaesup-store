const { createStore } = require('redux');
const { configureStore, createSlice } = require('@reduxjs/toolkit');
const { createStore: createZustandStore } = require('zustand/vanilla');
const { createStore: createJotaiStore, atom } = require('jotai/vanilla');
const { produce } = require('immer');

// 구조적 공유를 활용한 Gaesup-State (Rust 스타일)
class GaesupStateRustLike {
  constructor() {
    this.state = {};
    this.pathCache = new Map();
    this.memoryPool = [];
  }
  
  // 구조적 공유로 효율적인 복사
  structuralClone(obj, path, value) {
    const parts = this.pathCache.get(path) || path.split('.');
    if (!this.pathCache.has(path)) {
      this.pathCache.set(path, parts);
    }
    
    // 재귀적 구조적 공유
    const clone = (current, depth) => {
      if (depth === parts.length - 1) {
        return { ...current, [parts[depth]]: value };
      }
      
      const key = parts[depth];
      return {
        ...current,
        [key]: clone(current[key] || {}, depth + 1)
      };
    };
    
    return clone(obj, 0);
  }
  
  dispatch(path, value) {
    this.state = this.structuralClone(this.state, path, value);
    return this.state;
  }
  
  getState() {
    return this.state;
  }
}

// 성능 측정 함수
const benchmark = async (name, fn, iterations) => {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;
  const opsPerSec = 1000 / avgTime;
  
  return {
    name,
    totalTime: totalTime.toFixed(2),
    avgTime: avgTime.toFixed(6),
    opsPerSec: Math.round(opsPerSec),
    iterations
  };
};

// 테스트 데이터 생성
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

async function runBenchmarks() {
  console.log('🚀 Rust-like 구조적 공유 vs 기존 라이브러리 벤치마크\n');
  
  const scenarios = {
    "소량 (10개)": { size: 10, iterations: 10000 },
    "중량 (100개)": { size: 100, iterations: 5000 },
    "대량 (1000개)": { size: 1000, iterations: 1000 }
  };
  
  for (const [scenario, { size, iterations }] of Object.entries(scenarios)) {
    console.log(`📊 ${scenario} 테스트 중...\n`);
    
    const initialData = generateData(size);
    const results = [];
    
    // 1. Gaesup-State (Rust-like)
    const gaesupStore = new GaesupStateRustLike();
    gaesupStore.state = initialData;
    results.push(await benchmark('Gaesup-State (Rust-like)', () => {
      const idx = Math.floor(Math.random() * size);
      gaesupStore.dispatch(`key_${idx}.nested.metadata.count`, Math.random());
    }, iterations));
    
    // 2. Redux
    const reduxStore = createStore((state = initialData, action) => {
      if (action.type === 'UPDATE') {
        return produce(state, draft => {
          const parts = action.path.split('.');
          let current = draft;
          for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]];
          }
          current[parts[parts.length - 1]] = action.value;
        });
      }
      return state;
    });
    
    results.push(await benchmark('Redux', () => {
      const idx = Math.floor(Math.random() * size);
      reduxStore.dispatch({
        type: 'UPDATE',
        path: `key_${idx}.nested.metadata.count`,
        value: Math.random()
      });
    }, iterations));
    
    // 결과 출력
    results.sort((a, b) => b.opsPerSec - a.opsPerSec);
    
    console.log('라이브러리             | ops/sec      | 평균 시간 (μs)     | 순위');
    console.log('-'.repeat(70));
    results.forEach((result, index) => {
      console.log(
        `${result.name.padEnd(20)} | ${result.opsPerSec.toString().padStart(12)} | ${(parseFloat(result.avgTime) * 1000).toFixed(2).padStart(18)} | ${index + 1}`
      );
    });
    console.log('\n');
  }
}

runBenchmarks().catch(console.error); 