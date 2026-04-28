import { GaesupCore } from 'gaesup-state';

// 벤치마크 유틸리티
class Benchmark {
  private name: string;
  private iterations: number;
  
  constructor(name: string, iterations: number = 10000) {
    this.name = name;
    this.iterations = iterations;
  }
  
  async run(fn: () => void | Promise<void>): Promise<void> {
    console.log(`\n🏃 Running ${this.name}...`);
    
    // Warm up
    for (let i = 0; i < 100; i++) {
      await fn();
    }
    
    // 실제 벤치마크
    const start = performance.now();
    
    for (let i = 0; i < this.iterations; i++) {
      await fn();
    }
    
    const end = performance.now();
    const totalTime = end - start;
    const avgTime = totalTime / this.iterations;
    
    console.log(`✅ ${this.name} completed:`);
    console.log(`   Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`   Average per operation: ${avgTime.toFixed(4)}ms`);
    console.log(`   Operations per second: ${(1000 / avgTime).toFixed(0)}`);
    
    return;
  }
}

// 전통적인 JavaScript 상태 관리
class TraditionalStore {
  private state: any = {};
  private listeners: Set<Function> = new Set();
  
  setState(newState: any) {
    this.state = { ...this.state, ...newState };
    this.listeners.forEach(listener => listener(this.state));
  }
  
  getState() {
    return this.state;
  }
  
  subscribe(listener: Function) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// 벤치마크 실행
async function runBenchmarks() {
  console.log('🚀 Gaesup-State Performance Benchmark');
  console.log('=====================================');
  
  // Gaesup-State 초기화
  await GaesupCore.createStore('benchmark', { count: 0, items: [] });
  
  // Traditional Store 초기화
  const traditionalStore = new TraditionalStore();
  traditionalStore.setState({ count: 0, items: [] });
  
  // 1. 단순 상태 업데이트
  console.log('\n📊 Simple State Update (count++)');
  
  await new Benchmark('Gaesup-State', 10000).run(async () => {
    const current = GaesupCore.select('benchmark', 'count');
    await GaesupCore.dispatch('benchmark', 'SET', { count: current + 1 });
  });
  
  await new Benchmark('Traditional Store', 10000).run(() => {
    const current = traditionalStore.getState().count;
    traditionalStore.setState({ count: current + 1 });
  });
  
  // 2. 복잡한 객체 업데이트
  console.log('\n📊 Complex Object Update');
  
  const complexObject = {
    user: { name: 'Test', age: 25, preferences: { theme: 'dark' } },
    settings: { notifications: true, language: 'ko' },
    data: Array(100).fill(0).map((_, i) => ({ id: i, value: Math.random() }))
  };
  
  await new Benchmark('Gaesup-State', 1000).run(async () => {
    await GaesupCore.dispatch('benchmark', 'SET', complexObject);
  });
  
  await new Benchmark('Traditional Store', 1000).run(() => {
    traditionalStore.setState(complexObject);
  });
  
  // 3. 상태 읽기
  console.log('\n📊 State Reading');
  
  await new Benchmark('Gaesup-State', 100000).run(() => {
    GaesupCore.select('benchmark', 'user.name');
  });
  
  await new Benchmark('Traditional Store', 100000).run(() => {
    traditionalStore.getState().user?.name;
  });
  
  // 4. 배치 업데이트
  console.log('\n📊 Batch Updates (10 updates)');
  
  await new Benchmark('Gaesup-State', 1000).run(async () => {
    const batch = GaesupCore.createBatchUpdate('benchmark');
    for (let i = 0; i < 10; i++) {
      batch.addUpdate('MERGE', { [`item${i}`]: i });
    }
    await batch.execute();
  });
  
  await new Benchmark('Traditional Store', 1000).run(() => {
    const updates: any = {};
    for (let i = 0; i < 10; i++) {
      updates[`item${i}`] = i;
    }
    traditionalStore.setState(updates);
  });
  
  // 5. 메모리 사용량
  console.log('\n💾 Memory Usage');
  
  // 큰 데이터 생성
  const largeData = Array(10000).fill(0).map((_, i) => ({
    id: i,
    name: `Item ${i}`,
    data: Array(10).fill(0).map(() => Math.random()),
    metadata: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: ['tag1', 'tag2', 'tag3']
    }
  }));
  
  // Gaesup-State 메모리 사용량
  await GaesupCore.createStore('memory-test', { items: largeData });
  const gaesupMetrics = await GaesupCore.getMetrics('memory-test');
  console.log(`   Gaesup-State: ${(gaesupMetrics.memory_usage / 1024).toFixed(2)}KB`);
  
  // Traditional Store 메모리 사용량 (추정)
  const traditionalSize = JSON.stringify({ items: largeData }).length;
  console.log(`   Traditional Store: ${(traditionalSize / 1024).toFixed(2)}KB (estimated)`);
  
  // 6. 구독자 성능
  console.log('\n📡 Subscriber Performance (1000 subscribers)');
  
  // Gaesup-State 구독자
  const gaesupUnsubscribers: Function[] = [];
  const setupGaesupSubscribers = async () => {
    for (let i = 0; i < 1000; i++) {
      const callbackId = `callback_${i}`;
      GaesupCore.registerCallback(callbackId, () => {});
      const subId = GaesupCore.subscribe('benchmark', '', callbackId);
      gaesupUnsubscribers.push(() => GaesupCore.unsubscribe(subId));
    }
  };
  
  await setupGaesupSubscribers();
  
  await new Benchmark('Gaesup-State with 1000 subscribers', 1000).run(async () => {
    await GaesupCore.dispatch('benchmark', 'SET', { count: Math.random() });
  });
  
  // Traditional Store 구독자
  const traditionalUnsubscribers: Function[] = [];
  for (let i = 0; i < 1000; i++) {
    traditionalUnsubscribers.push(traditionalStore.subscribe(() => {}));
  }
  
  await new Benchmark('Traditional Store with 1000 subscribers', 1000).run(() => {
    traditionalStore.setState({ count: Math.random() });
  });
  
  // 정리
  gaesupUnsubscribers.forEach(fn => fn());
  traditionalUnsubscribers.forEach(fn => fn());
  
  // 7. 스냅샷 성능
  console.log('\n📸 Snapshot Performance');
  
  const snapshotIds: string[] = [];
  
  await new Benchmark('Gaesup-State Snapshot Creation', 100).run(async () => {
    const id = await GaesupCore.createSnapshot('benchmark');
    snapshotIds.push(id);
  });
  
  await new Benchmark('Gaesup-State Snapshot Restore', 100).run(async () => {
    const id = snapshotIds[Math.floor(Math.random() * snapshotIds.length)];
    await GaesupCore.restoreSnapshot('benchmark', id);
  });
  
  // 최종 메트릭스
  console.log('\n📈 Final Metrics');
  const finalMetrics = await GaesupCore.getMetrics('benchmark');
  console.log('   Total dispatches:', finalMetrics.total_dispatches);
  console.log('   Total selects:', finalMetrics.total_selects);
  console.log('   Average dispatch time:', finalMetrics.avg_dispatch_time.toFixed(4) + 'ms');
  console.log('   Average select time:', finalMetrics.avg_select_time.toFixed(4) + 'ms');
  
  // 정리
  await GaesupCore.cleanupStore('benchmark');
  await GaesupCore.cleanupStore('memory-test');
  await GaesupCore.garbageCollect();
  
  console.log('\n✅ Benchmark completed!');
}

// 실행
if (typeof window !== 'undefined') {
  (window as any).runBenchmarks = runBenchmarks;
  console.log('Run benchmarks with: window.runBenchmarks()');
} else if (typeof global !== 'undefined') {
  runBenchmarks().catch(console.error);
} 