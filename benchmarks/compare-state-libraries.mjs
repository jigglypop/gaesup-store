import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { createStore as createZustandStore } from 'zustand/vanilla';
import { atom, createStore as createJotaiStore } from 'jotai/vanilla';
import { createStore as createReduxStore } from 'redux';

const require = createRequire(import.meta.url);
const wasm = require('../packages/core-rust/pkg-node/gaesup_state_core.js');

const ITERATIONS = {
  update: 10000,
  read: 100000,
  notify: 10000,
  batch: 1000
};

const WARMUP = 200;

const results = [];

async function measure(library, test, iterations, fn) {
  for (let i = 0; i < Math.min(WARMUP, iterations); i++) {
    await fn(i);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn(i);
  }
  const totalMs = performance.now() - start;
  const avgUs = (totalMs * 1000) / iterations;

  results.push({ library, test, iterations, totalMs, avgUs });
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log('-'.repeat(96));
  console.log(
    'Library'.padEnd(18) +
      'Test'.padEnd(26) +
      'Iterations'.padStart(12) +
      'Total ms'.padStart(14) +
      'Avg us/op'.padStart(16)
  );
  console.log('-'.repeat(96));

  for (const row of rows) {
    console.log(
      row.library.padEnd(18) +
        row.test.padEnd(26) +
        String(row.iterations).padStart(12) +
        row.totalMs.toFixed(3).padStart(14) +
        row.avgUs.toFixed(3).padStart(16)
    );
  }
}

function printRelative(testName) {
  const rows = results.filter((row) => row.test === testName);
  const gaesup = rows.find((row) => row.library === 'Gaesup');
  if (!gaesup) return;

  console.log(`\nRelative to Gaesup: ${testName}`);
  console.log('-'.repeat(64));
  for (const row of rows) {
    const ratio = row.avgUs / gaesup.avgUs;
    const label = ratio >= 1 ? `${ratio.toFixed(2)}x slower` : `${(1 / ratio).toFixed(2)}x faster`;
    console.log(`${row.library.padEnd(18)} ${label.padStart(18)} (${row.avgUs.toFixed(3)} us/op)`);
  }
}

async function benchGaesup() {
  const storeId = 'bench-state-libraries';
  try {
    wasm.cleanup_store(storeId);
  } catch {
    // Store may not exist on the first run.
  }
  wasm.init?.();
  wasm.create_store(storeId, { count: 0, nested: { value: 0 }, notified: 0 });

  await measure('Gaesup', 'increment update rich', ITERATIONS.update, async () => {
    wasm.dispatch_counter(storeId, 1, 'bench', 'INCREMENT');
  });

  await measure('Gaesup', 'increment update fast', ITERATIONS.update, async () => {
    wasm.dispatch_counter_fast(storeId, 1);
  });

  const counterHandle = wasm.create_counter_handle(storeId);
  await measure('Gaesup', 'increment update handle', ITERATIONS.update, async () => {
    wasm.dispatch_counter_handle_fast(counterHandle, 1);
  });

  await measure('Gaesup', 'increment update unchecked', ITERATIONS.update, async () => {
    wasm.dispatch_counter_handle_fast_unchecked(counterHandle, 1);
  });

  await measure('Gaesup', 'nested read', ITERATIONS.read, () => {
    wasm.select(storeId, 'nested.value');
  });

  let notified = 0;
  const subscriptionId = wasm.subscribe(storeId, '', () => {
    notified++;
  });

  await measure('Gaesup', 'notify subscriber', ITERATIONS.notify, async (i) => {
    wasm.dispatch(storeId, 'MERGE', { notified: i });
  });

  wasm.unsubscribe(subscriptionId);

  await measure('Gaesup', 'batch 1000 increments rich', ITERATIONS.batch, async () => {
    wasm.dispatch_counter_batch(storeId, 1, 1000, 'bench', 'INCREMENT_BATCH');
  });

  await measure('Gaesup', 'batch 1000 increments fast', ITERATIONS.batch, async () => {
    wasm.dispatch_counter_batch_fast(storeId, 1, 1000);
  });

  await measure('Gaesup', 'batch 1000 increments handle', ITERATIONS.batch, async () => {
    wasm.dispatch_counter_handle_batch_fast(counterHandle, 1, 1000);
  });

  await measure('Gaesup', 'batch 1000 increments unchecked', ITERATIONS.batch, async () => {
    wasm.dispatch_counter_handle_batch_fast_unchecked(counterHandle, 1, 1000);
  });
  wasm.release_counter_handle(counterHandle);

  const metrics = wasm.get_metrics(storeId);
  wasm.cleanup_store(storeId);
  return { notified, metrics };
}

async function benchZustand() {
  const store = createZustandStore((set, get) => ({
    count: 0,
    nested: { value: 0 },
    notified: 0,
    increment: () => set((state) => ({ count: state.count + 1 })),
    setNotified: (value) => set({ notified: value }),
    batchIncrement: (count) => {
      for (let i = 0; i < count; i++) {
        set((state) => ({ count: state.count + 1 }));
      }
    },
    getNested: () => get().nested.value
  }));

  await measure('Zustand', 'increment update fast', ITERATIONS.update, () => {
    store.getState().increment();
  });

  await measure('Zustand', 'nested read', ITERATIONS.read, () => {
    store.getState().getNested();
  });

  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified++;
  });

  await measure('Zustand', 'notify subscriber', ITERATIONS.notify, (i) => {
    store.getState().setNotified(i);
  });

  unsubscribe();

  await measure('Zustand', 'batch 1000 increments fast', ITERATIONS.batch, () => {
    store.getState().batchIncrement(1000);
  });

  return { notified };
}

async function benchJotai() {
  const countAtom = atom(0);
  const nestedAtom = atom({ value: 0 });
  const notifiedAtom = atom(0);
  const store = createJotaiStore();

  await measure('Jotai', 'increment update fast', ITERATIONS.update, () => {
    store.set(countAtom, store.get(countAtom) + 1);
  });

  await measure('Jotai', 'nested read', ITERATIONS.read, () => {
    store.get(nestedAtom).value;
  });

  let notified = 0;
  const unsubscribe = store.sub(notifiedAtom, () => {
    notified++;
  });

  await measure('Jotai', 'notify subscriber', ITERATIONS.notify, (i) => {
    store.set(notifiedAtom, i);
  });

  unsubscribe();

  await measure('Jotai', 'batch 1000 increments fast', ITERATIONS.batch, () => {
    for (let i = 0; i < 1000; i++) {
      store.set(countAtom, store.get(countAtom) + 1);
    }
  });

  return { notified };
}

async function benchRedux() {
  function reducer(state = { count: 0, nested: { value: 0 }, notified: 0 }, action) {
    switch (action.type) {
      case 'increment':
        return { ...state, count: state.count + 1 };
      case 'notified':
        return { ...state, notified: action.payload };
      case 'batchIncrement':
        return { ...state, count: state.count + action.payload };
      default:
        return state;
    }
  }

  const store = createReduxStore(reducer);

  await measure('Redux', 'increment update fast', ITERATIONS.update, () => {
    store.dispatch({ type: 'increment' });
  });

  await measure('Redux', 'nested read', ITERATIONS.read, () => {
    store.getState().nested.value;
  });

  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified++;
  });

  await measure('Redux', 'notify subscriber', ITERATIONS.notify, (i) => {
    store.dispatch({ type: 'notified', payload: i });
  });

  unsubscribe();

  await measure('Redux', 'batch 1000 increments fast', ITERATIONS.batch, () => {
    for (let i = 0; i < 1000; i++) {
      store.dispatch({ type: 'increment' });
    }
  });

  return { notified };
}

async function main() {
  console.log('State library benchmark');
  console.log(`Node ${process.version}`);
  console.log('Libraries: Gaesup Rust WASM pkg-node, Zustand vanilla, Jotai vanilla, Redux');
  console.log('Note: Gaesup crosses the JS/WASM boundary. Zustand, Jotai, and Redux run in plain JS.');

  const meta = {};
  meta.gaesup = await benchGaesup();
  meta.zustand = await benchZustand();
  meta.jotai = await benchJotai();
  meta.redux = await benchRedux();

  printTable('Results', results);
  printRelative('increment update rich');
  printRelative('increment update fast');
  printRelative('increment update handle');
  printRelative('increment update unchecked');
  printRelative('nested read');
  printRelative('notify subscriber');
  printRelative('batch 1000 increments rich');
  printRelative('batch 1000 increments fast');
  printRelative('batch 1000 increments handle');
  printRelative('batch 1000 increments unchecked');

  console.log('\nGaesup metrics');
  console.log(JSON.stringify(meta.gaesup.metrics, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
