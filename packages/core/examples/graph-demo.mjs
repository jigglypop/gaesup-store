// Runnable demo of the Gaesup graph plane (Runtime Spec v0.1 §69-71 scenario).
//
// The dist output uses extensionless ESM imports, so bundle before running:
//
//   pnpm --dir packages/core build   (once, to refresh dist)
//   node node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild \
//     packages/core/examples/graph-demo.mjs --bundle --format=esm \
//     --platform=node --outfile=graph-demo.bundle.mjs
//   node graph-demo.bundle.mjs
//
// Imports go through the built package boundary (dist). The graph modules are
// pure JS — no WASM needed for this demo.

import { batch, derived, state, subscribeGraphTrace, snapshotGraph, restoreGraph, transaction } from '../dist/graph.js';
import { command } from '../dist/graph-command.js';
import { graphResource } from '../dist/graph-resource.js';
import { graphStream } from '../dist/graph-stream.js';
import { createRuntime, defineContainer } from '../dist/graph-runtime.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (label, message) => console.log(`${label.padEnd(12)} ${message}`);

// --- Trace: watch the graph work (§52) --------------------------------------
const stopTrace = subscribeGraphTrace((event) => {
  if (event.node.startsWith('demo.')) {
    log('[trace]', `${event.type} ${event.node} v${event.version}`);
  }
});

// --- Fake backend ------------------------------------------------------------
const api = {
  login: async (name) => ({ id: 42, name }),
  portfolio: async (userId, account) =>
    userId === undefined
      ? []
      : [
          { symbol: 'BTC', quantity: 2 },
          { symbol: 'ETH', quantity: 10 }
        ]
};

let pushPrice = () => {};

// --- Containers (§69-70) ------------------------------------------------------
const runtime = createRuntime({ env: { STAGE: 'demo' } });

runtime.register(
  defineContainer({
    name: 'auth',
    version: '1.0.0',
    setup() {
      const user = state(null, { id: 'demo.auth.user' });
      const authenticated = derived(() => user.get() !== null, { id: 'demo.auth.authenticated' });
      const login = command({
        execute: (name) => api.login(name),
        commit: (result) => user.set(result)
      });
      return { exposes: { user, authenticated, login } };
    }
  })
);

runtime.register(
  defineContainer({
    name: 'market',
    setup() {
      const price = graphStream({
        id: 'demo.market.price',
        subscribe(observer) {
          pushPrice = (value) => observer.next(value);
          return () => {
            pushPrice = () => {};
          };
        }
      });
      return { exposes: { price } };
    }
  })
);

runtime.register(
  defineContainer({
    name: 'portfolio',
    dependencies: ['auth', 'market'],
    setup({ consume }) {
      const user = consume('auth.user');
      const price = consume('market.price');
      const portfolio = graphResource({
        id: 'demo.portfolio',
        key: () => ['portfolio', user.get()?.id],
        fetch: async ([, userId]) => api.portfolio(userId)
      });
      const total = derived(
        () => {
          const assets = portfolio.get().data ?? [];
          const unit = price.get() ?? 0;
          return assets.reduce((sum, asset) => sum + asset.quantity * unit, 0);
        },
        { id: 'demo.portfolio.total' }
      );
      return { exposes: { total, portfolio } };
    }
  })
);

// --- Run ----------------------------------------------------------------------
console.log('=== 1. Runtime startup (topological: auth, market -> portfolio) ===');
runtime.startAll();
for (const info of runtime.containers()) {
  log('[container]', `${info.name}@${info.version ?? '-'} ${info.status} (${runtime.health(info.name)})`);
}

console.log('\n=== 2. A view subscribes to portfolio.total ===');
const total = runtime.consume('portfolio.total');
total.subscribe((value) => log('[view]', `PortfolioSummary re-rendered: total = ${value}`));

console.log('\n=== 3. login command -> auth.user -> resource key -> auto refetch ===');
const login = runtime.consume('auth.login');
await login('ada');
log('[auth]', `authenticated = ${runtime.consume('auth.authenticated').get()}`);
await sleep(10); // resource fetch resolves
log('[resource]', `portfolio = ${JSON.stringify(runtime.consume('portfolio.portfolio').get().data)}`);

console.log('\n=== 4. realtime price stream -> derived total -> view ===');
pushPrice(100);
pushPrice(150);

console.log('\n=== 5. transaction: atomic transfer (observers see no intermediate state) ===');
const a = state(1000, { id: 'demo.balance.a' });
const b = state(0, { id: 'demo.balance.b' });
const sum = derived(() => a.get() + b.get(), { id: 'demo.balance.sum' });
sum.subscribe((value) => log('[view]', `balance sum notified: ${value} (should never fire on transfer)`));
transaction(() => {
  a.set(a.get() - 300);
  b.set(b.get() + 300);
});
log('[state]', `a=${a.get()} b=${b.get()} sum=${sum.get()}`);

console.log('\n=== 6. optimistic command that fails -> automatic rollback ===');
const nickname = state('ada', { id: 'demo.nickname' });
nickname.subscribe((value) => log('[view]', `nickname rendered: ${value}`));
const rename = command({
  optimistic: (next) => nickname.set(next),
  execute: async () => {
    throw new Error('server rejected');
  }
});
await rename('hacker').catch((error) => log('[command]', `failed: ${error.message}`));
log('[state]', `nickname after rollback = ${nickname.get()}`);

console.log('\n=== 7. snapshot / restore (time travel) ===');
const snapshot = snapshotGraph((id) => id.startsWith('demo.balance'));
batch(() => {
  a.set(1);
  b.set(2);
});
log('[state]', `mutated: a=${a.get()} b=${b.get()}`);
restoreGraph(snapshot);
log('[state]', `restored: a=${a.get()} b=${b.get()}`);

console.log('\n=== 8. failure isolation: a crashing container stays contained ===');
runtime.onContainerError((error) => log('[runtime]', `container "${error.container}" failed in ${error.phase}: ${error.cause.message}`));
runtime.register(
  defineContainer({
    name: 'chat',
    setup() {
      throw new Error('chat exploded');
    }
  })
);
runtime.start('chat');
log('[container]', `chat=${runtime.status('chat')} portfolio=${runtime.status('portfolio')} (unaffected)`);

stopTrace();
console.log('\ndemo complete.');
