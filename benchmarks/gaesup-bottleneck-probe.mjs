import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasm = require('../packages/core-rust/pkg-node/gaesup_state_core.js');

wasm.init?.();

function resetStore(storeId, state) {
  try {
    wasm.cleanup_store(storeId);
  } catch {
    // The store may not exist yet.
  }
  wasm.create_store(storeId, state);
}

function measure(name, iterations, fn) {
  for (let i = 0; i < Math.min(200, iterations); i++) {
    fn(i);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn(i);
  }
  const totalMs = performance.now() - start;
  const avgUs = (totalMs * 1000) / iterations;

  console.log(
    name.padEnd(36) +
      String(iterations).padStart(10) +
      totalMs.toFixed(3).padStart(14) +
      avgUs.toFixed(3).padStart(14)
  );
}

console.log('Gaesup bottleneck probe');
console.log('Node', process.version);
console.log('-'.repeat(74));
console.log('Case'.padEnd(36) + 'Iterations'.padStart(10) + 'Total ms'.padStart(14) + 'Avg us/op'.padStart(14));
console.log('-'.repeat(74));

resetStore('probe-select', { count: 0 });
measure('select tiny count', 100000, () => {
  wasm.select('probe-select', 'count');
});

resetStore('probe-set', { count: 0 });
measure('dispatch SET tiny', 10000, (i) => {
  wasm.dispatch('probe-set', 'SET', { count: i });
});

resetStore('probe-merge', { count: 0, nested: { value: 0 } });
measure('dispatch MERGE tiny no sub', 10000, (i) => {
  wasm.dispatch('probe-merge', 'MERGE', { notified: i });
});

resetStore('probe-counter', { count: 0 });
measure('dispatch_counter no history init', 10000, () => {
  wasm.dispatch_counter('probe-counter', 1, 'bench', 'INCREMENT');
});

resetStore('probe-counter-fast', { count: 0 });
measure('dispatch_counter_fast', 10000, () => {
  wasm.dispatch_counter_fast('probe-counter-fast', 1);
});

resetStore('probe-counter-handle-fast', { count: 0 });
const counterHandle = wasm.create_counter_handle('probe-counter-handle-fast');
measure('dispatch_counter_handle_fast', 10000, () => {
  wasm.dispatch_counter_handle_fast(counterHandle, 1);
});
measure('dispatch_counter_handle_fast_unchecked', 10000, () => {
  wasm.dispatch_counter_handle_fast_unchecked(counterHandle, 1);
});
wasm.release_counter_handle(counterHandle);

resetStore('probe-counter-history', { count: 0, history: [] });
measure('dispatch_counter with history', 10000, () => {
  wasm.dispatch_counter('probe-counter-history', 1, 'bench', 'INCREMENT');
});

resetStore('probe-counter-batch', { count: 0, history: [] });
measure('dispatch_counter_batch 1000', 1000, () => {
  wasm.dispatch_counter_batch('probe-counter-batch', 1, 1000, 'bench', 'BATCH');
});

resetStore('probe-counter-batch-fast', { count: 0 });
measure('dispatch_counter_batch_fast 1000', 1000, () => {
  wasm.dispatch_counter_batch_fast('probe-counter-batch-fast', 1, 1000);
});

resetStore('probe-counter-handle-batch-fast', { count: 0 });
const counterBatchHandle = wasm.create_counter_handle('probe-counter-handle-batch-fast');
measure('dispatch_counter_handle_batch_fast 1000', 1000, () => {
  wasm.dispatch_counter_handle_batch_fast(counterBatchHandle, 1, 1000);
});
measure('dispatch_counter_handle_batch_unchecked 1000', 1000, () => {
  wasm.dispatch_counter_handle_batch_fast_unchecked(counterBatchHandle, 1, 1000);
});
wasm.release_counter_handle(counterBatchHandle);

resetStore('probe-sub-root', { count: 0 });
const rootSub = wasm.subscribe('probe-sub-root', '', () => {});
measure('dispatch MERGE root subscriber', 10000, (i) => {
  wasm.dispatch('probe-sub-root', 'MERGE', { count: i });
});
wasm.unsubscribe(rootSub);

resetStore('probe-sub-path', { count: 0 });
const pathSub = wasm.subscribe('probe-sub-path', 'count', () => {});
measure('dispatch MERGE path subscriber', 10000, (i) => {
  wasm.dispatch('probe-sub-path', 'MERGE', { count: i });
});
wasm.unsubscribe(pathSub);

const renderDirtyBuffer = wasm.benchmark_render_dirty_matrix_buffer(10000, 1000);
const renderDirtyRangesPacked = wasm.benchmark_render_dirty_matrix_ranges(10000, 1000, 1);
const renderDirtyRangesSparse = wasm.benchmark_render_dirty_matrix_ranges(10000, 1000, 4);

console.log('\nRender/WebGPU state probes');
console.log('-'.repeat(74));
console.log(`dirty matrix buffer 10k/1k`.padEnd(36) + `${renderDirtyBuffer.dirtyMatrixBufferMs.toFixed(3)} ms`.padStart(24));
console.log(`dirty matrix ranges packed`.padEnd(36) + `${renderDirtyRangesPacked.dirtyMatrixRangeMs.toFixed(3)} ms`.padStart(24));
console.log(`dirty matrix ranges sparse`.padEnd(36) + `${renderDirtyRangesSparse.dirtyMatrixRangeMs.toFixed(3)} ms`.padStart(24));
console.log(`packed range count`.padEnd(36) + String(renderDirtyRangesPacked.rangeCount).padStart(24));
console.log(`sparse range count`.padEnd(36) + String(renderDirtyRangesSparse.rangeCount).padStart(24));

for (const storeId of [
  'probe-select',
  'probe-set',
  'probe-merge',
  'probe-counter',
  'probe-counter-fast',
  'probe-counter-handle-fast',
  'probe-counter-history',
  'probe-counter-batch',
  'probe-counter-batch-fast',
  'probe-counter-handle-batch-fast',
  'probe-sub-root',
  'probe-sub-path'
]) {
  wasm.cleanup_store(storeId);
}
