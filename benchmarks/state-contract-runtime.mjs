import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { createStore as createZustandStore } from 'zustand/vanilla';
import { atom, createStore as createJotaiStore } from 'jotai/vanilla';
import { createStore as createReduxStore } from 'redux';

const require = createRequire(import.meta.url);
const wasm = require('../packages/core-rust/pkg-node/gaesup_state_core.js');

const ITERATIONS = {
  json: 20_000,
  batch: 5_000,
  fast: 100_000,
  machine: 50_000,
  read: 200_000
};

const WARMUP = 500;
const rows = [];

wasm.init?.();

async function measure(group, name, iterations, fn) {
  for (let index = 0; index < Math.min(WARMUP, iterations); index += 1) {
    await fn(index);
  }

  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await fn(index);
  }
  const totalMs = performance.now() - start;
  rows.push({
    group,
    name,
    iterations,
    totalMs,
    avgUs: (totalMs * 1000) / iterations,
    ops: iterations / (totalMs / 1000)
  });
}

function resetStore(storeId, state) {
  try {
    wasm.cleanup_store(storeId);
  } catch {
    // Store may not exist.
  }
  wasm.create_store(storeId, state);
}

async function benchGaesupJson() {
  resetStore('bench-json', { count: 0, nested: { value: 0 }, fields: {} });

  await measure('Gaesup', 'dispatch UPDATE JSON path', ITERATIONS.json, (index) => {
    wasm.dispatch('bench-json', 'UPDATE', { path: 'nested.value', value: index });
  });

  await measure('Gaesup', 'dispatch MERGE tiny', ITERATIONS.json, (index) => {
    wasm.dispatch('bench-json', 'MERGE', { count: index });
  });

  await measure('Gaesup', 'select nested path', ITERATIONS.read, () => {
    wasm.select('bench-json', 'nested.value');
  });

  wasm.cleanup_store('bench-json');
}

async function benchGaesupBatch() {
  resetStore('bench-batch', { fields: {} });
  const payload = Array.from({ length: 10 }, (_, index) => ({
    actionType: 'UPDATE',
    payload: { path: `fields.k${index}`, value: index }
  }));

  await measure('Gaesup', 'dispatch BATCH 10 updates', ITERATIONS.batch, () => {
    wasm.dispatch('bench-batch', 'BATCH', payload);
  });

  wasm.cleanup_store('bench-batch');
}

async function benchGaesupFastLane() {
  resetStore('bench-fast', { count: 0 });
  const handle = wasm.create_counter_handle('bench-fast');

  await measure('Gaesup', 'counter handle fast', ITERATIONS.fast, () => {
    wasm.dispatch_counter_handle_fast(handle, 1);
  });

  await measure('Gaesup', 'counter handle unchecked', ITERATIONS.fast, () => {
    wasm.dispatch_counter_handle_fast_unchecked(handle, 1);
  });

  await measure('Gaesup', 'counter batch 1000 handle', ITERATIONS.batch, () => {
    wasm.dispatch_counter_handle_batch_fast(handle, 1, 1000);
  });

  wasm.release_counter_handle(handle);
  wasm.cleanup_store('bench-fast');
}

async function benchGaesupMachine() {
  try {
    wasm.cleanup_machine('bench-machine');
  } catch {
    // Machine may not exist.
  }
  const machineId = wasm.create_machine({
    id: 'bench-machine',
    initial: 'idle',
    context: { count: 0 },
    historyLimit: 0,
    checkpointLimit: 0,
    states: {
      idle: {
        on: {
          TICK: {
            target: 'idle',
            assign: { count: '$event.count' }
          }
        }
      }
    }
  });
  wasm.start_machine(machineId, null);

  await measure('Gaesup', 'machine transition assign hot', ITERATIONS.machine, (index) => {
    wasm.send_machine(machineId, { type: 'TICK', count: index });
  });

  await measure('Gaesup', 'machine snapshot read', ITERATIONS.read, () => {
    wasm.get_machine_snapshot(machineId);
  });

  wasm.cleanup_machine(machineId);

  const tracedMachineId = wasm.create_machine({
    id: 'bench-machine-traced',
    initial: 'idle',
    context: { count: 0 },
    states: {
      idle: {
        on: {
          TICK: {
            target: 'idle',
            assign: { count: '$event.count' },
            action: 'recordTick'
          }
        }
      }
    }
  });
  wasm.start_machine(tracedMachineId, null);

  await measure('Gaesup', 'machine traced assign+effect', 5_000, (index) => {
    wasm.send_machine(tracedMachineId, { type: 'TICK', count: index });
  });

  wasm.cleanup_machine(tracedMachineId);
}

async function benchJsBaseline() {
  const state = { count: 0, nested: { value: 0 }, fields: {} };

  await measure('Plain JS', 'mutate nested value', ITERATIONS.fast, (index) => {
    state.nested.value = index;
  });

  await measure('Plain JS', 'flat machine transition', ITERATIONS.machine, (index) => {
    state.count = index;
  });
}

async function benchZustand() {
  const store = createZustandStore((set, get) => ({
    count: 0,
    nested: { value: 0 },
    setNested: (value) => set((state) => ({ nested: { ...state.nested, value } })),
    getNested: () => get().nested.value
  }));

  await measure('Zustand', 'set nested object', ITERATIONS.json, (index) => {
    store.getState().setNested(index);
  });

  await measure('Zustand', 'read nested path', ITERATIONS.read, () => {
    store.getState().getNested();
  });
}

async function benchJotai() {
  const nestedAtom = atom({ value: 0 });
  const store = createJotaiStore();

  await measure('Jotai', 'set nested atom', ITERATIONS.json, (index) => {
    store.set(nestedAtom, { value: index });
  });

  await measure('Jotai', 'read nested atom', ITERATIONS.read, () => {
    store.get(nestedAtom).value;
  });
}

async function benchRedux() {
  const reducer = (state = { count: 0, nested: { value: 0 } }, action) => {
    if (action.type === 'setNested') {
      return { ...state, nested: { ...state.nested, value: action.payload } };
    }
    return state;
  };
  const store = createReduxStore(reducer);

  await measure('Redux', 'dispatch nested update', ITERATIONS.json, (index) => {
    store.dispatch({ type: 'setNested', payload: index });
  });

  await measure('Redux', 'read nested path', ITERATIONS.read, () => {
    store.getState().nested.value;
  });
}

async function benchOptionalXState() {
  let xstate;
  try {
    xstate = await import('xstate');
  } catch {
    rows.push({
      group: 'XState',
      name: 'not installed',
      iterations: 0,
      totalMs: 0,
      avgUs: 0,
      ops: 0,
      skipped: true
    });
    return;
  }

  const machine = xstate.createMachine({
    id: 'bench',
    initial: 'idle',
    context: { count: 0 },
    states: {
      idle: {
        on: {
          TICK: {
            actions: xstate.assign({
              count: ({ event }) => event.count
            })
          }
        }
      }
    }
  });
  const actor = xstate.createActor(machine).start();

  await measure('XState', 'machine transition assign', ITERATIONS.machine, (index) => {
    actor.send({ type: 'TICK', count: index });
  });

  actor.stop();
}

function printRows() {
  console.log('State Contract Runtime benchmark');
  console.log(`Node ${process.version}`);
  console.log('Note: Gaesup WASM paths cross the JS/WASM boundary. Plain JS and JS libraries do not.');
  console.log('-'.repeat(104));
  console.log(
    'Group'.padEnd(12) +
      'Case'.padEnd(36) +
      'Iterations'.padStart(12) +
      'Total ms'.padStart(14) +
      'Avg us/op'.padStart(14) +
      'Ops/sec'.padStart(16)
  );
  console.log('-'.repeat(104));

  for (const row of rows) {
    if (row.skipped) {
      console.log(row.group.padEnd(12) + row.name.padEnd(36) + 'SKIPPED'.padStart(56));
      continue;
    }
    console.log(
      row.group.padEnd(12) +
        row.name.padEnd(36) +
        String(row.iterations).padStart(12) +
        row.totalMs.toFixed(3).padStart(14) +
        row.avgUs.toFixed(3).padStart(14) +
        Math.round(row.ops).toLocaleString('en-US').padStart(16)
    );
  }
}

await benchGaesupJson();
await benchGaesupBatch();
await benchGaesupFastLane();
await benchGaesupMachine();
await benchJsBaseline();
await benchZustand();
await benchJotai();
await benchRedux();
await benchOptionalXState();
printRows();
