# Machine Runtime

Gaesup should support deterministic step workflows inspired by state machines and statecharts. The first implementation should be intentionally smaller than XState and optimized for WASM execution.

## Why Machines

Generic state stores answer:

```text
What is the current data?
```

Machines answer:

```text
What step is this container allowed to be in, and which events may move it?
```

This is important for commercial frontend containers because operators need to understand and control:

- Checkout steps.
- Onboarding flows.
- Upload/import pipelines.
- Approval workflows.
- Multi-container coordination.
- Rollback and recovery points.

## Core Rule

Pure transition logic runs in Rust/WASM. Side effects run in the JS host through capability-checked effect descriptors.

```text
event
  -> WASM transition
  -> next snapshot
  -> effect descriptors
  -> host permission check
  -> JS effect execution
  -> effect result event
```

The machine runtime must not directly perform network requests, DOM writes, storage access, or cross-container calls from Rust/WASM.

## V1 Scope

V1 should support flat finite-state workflows.

Included:

- Machine definition.
- Initial state.
- Context object.
- Event transitions.
- Guards by name.
- Assign/context patches.
- Entry action descriptors.
- Exit action descriptors.
- Transition action descriptors.
- Final states.
- Snapshots.
- Step history.
- Rollback to previous snapshot.
- Metrics and timeline events.

Excluded from V1:

- Nested states.
- Parallel states.
- Delayed transitions.
- Actor spawning.
- Promise actors.
- Observable actors.
- Visual editor.
- Full XState compatibility.

## Machine Definition

```ts
const checkout = createMachine({
  id: 'checkout-flow',
  initial: 'cart',
  context: {
    items: [],
    shippingAddress: null,
    paymentId: null
  },
  guards: {
    hasItems: 'hasItems'
  },
  states: {
    cart: {
      on: {
        NEXT: {
          target: 'shipping',
          guard: 'hasItems'
        }
      }
    },
    shipping: {
      on: {
        NEXT: {
          target: 'payment'
        },
        BACK: {
          target: 'cart'
        }
      }
    },
    payment: {
      on: {
        PAY: {
          target: 'processing',
          action: 'requestPayment'
        }
      }
    },
    processing: {
      on: {
        RESOLVE: {
          target: 'done',
          assign: {
            paymentId: '$event.paymentId'
          }
        },
        REJECT: {
          target: 'payment',
          action: 'showPaymentError'
        }
      }
    },
    done: {
      final: true
    }
  }
});
```

## Machine Snapshot

```ts
interface MachineSnapshot<TContext = any> {
  machineId: string;
  state: string;
  context: TContext;
  status: 'active' | 'final' | 'error';
  step: number;
  history: MachineHistoryEntry[];
  changed: boolean;
  actions: MachineEffectDescriptor[];
}
```

History entries should be compact:

```ts
interface MachineHistoryEntry {
  from: string;
  to: string;
  event: string;
  timestamp: number;
  durationMs: number;
}
```

## Event Result

When an event is sent, WASM should return a transition result instead of mutating side effects directly.

```ts
interface MachineTransitionResult<TContext = any> {
  accepted: boolean;
  snapshot: MachineSnapshot<TContext>;
  rejectedReason?: string;
  effects: MachineEffectDescriptor[];
}
```

Example effect descriptor:

```ts
{
  id: 'effect_123',
  type: 'requestPayment',
  payload: {
    amount: 3900
  },
  permission: 'effects:requestPayment'
}
```

The host checks whether the container has permission to request the effect.

## Guard Model

V1 should support guard names rather than arbitrary JS functions inside WASM.

```ts
{
  guard: 'hasItems'
}
```

The host can register guard implementations:

```ts
const actor = createActor(checkout, {
  guards: {
    hasItems: ({ context }) => context.items.length > 0
  }
});
```

For maximum determinism, prefer simple declarative guards later:

```ts
{
  guard: {
    path: 'items.length',
    op: '>',
    value: 0
  }
}
```

## Assign Model

V1 should support simple context patches.

```ts
{
  assign: {
    paymentId: '$event.paymentId',
    updatedAt: '$now'
  }
}
```

The Rust runtime can resolve known tokens:

- `$event.*`
- `$context.*`
- `$now`

Avoid arbitrary expression evaluation in V1.

## Actor API Sketch

```ts
const actor = createActor(checkout, {
  storeId: 'checkout',
  effects: {
    async requestPayment({ payload }) {
      return paymentClient.request(payload);
    }
  },
  guards: {
    hasItems({ context }) {
      return context.items.length > 0;
    }
  }
});

await actor.start();

actor.subscribe((snapshot) => {
  console.log(snapshot.state, snapshot.context);
});

await actor.send({ type: 'NEXT' });
await actor.send({ type: 'PAY', amount: 3900 });
```

## Store Integration

Each machine instance should persist its snapshot into a Gaesup store.

Recommended store shape:

```ts
{
  machines: {
    'checkout-flow': {
      state: 'payment',
      context: {},
      step: 2,
      status: 'active',
      history: []
    }
  }
}
```

Machine snapshots should be observable through normal Gaesup subscriptions.

## Rollback

Rollback should restore a previous snapshot and emit a timeline event.

```ts
await actor.rollback({ steps: 1 });
```

Rollback should not automatically undo already executed external side effects. If an effect needs compensation, it should be represented as another explicit effect.

## Timeline Events

The machine runtime should emit:

- `machine:created`
- `machine:started`
- `machine:event`
- `machine:transitioned`
- `machine:rejected`
- `machine:effect-requested`
- `machine:effect-denied`
- `machine:effect-resolved`
- `machine:effect-rejected`
- `machine:rollback`
- `machine:final`

These events should include:

- `containerId`
- `storeId`
- `machineId`
- `from`
- `to`
- `event`
- `durationMs`
- `timestamp`

## Rust Module Plan

Add a `machine.rs` module in `packages/core-rust/src`.

Initial exported functions:

```rust
create_machine(definition: JsValue) -> Result<String, JsValue>
start_machine(machine_id: &str, context: JsValue) -> Result<JsValue, JsValue>
send_machine(machine_id: &str, event: JsValue) -> Result<JsValue, JsValue>
get_machine_snapshot(machine_id: &str) -> Result<JsValue, JsValue>
rollback_machine(machine_id: &str, steps: u32) -> Result<JsValue, JsValue>
cleanup_machine(machine_id: &str)
```

The first implementation can use JSON-compatible values. Later hot paths can add typed context lanes for common workflow data.

## TypeScript Wrapper Plan

Public API candidates:

```ts
createMachine(definition)
createActor(machine, options)
actor.start()
actor.send(event)
actor.subscribe(listener)
actor.getSnapshot()
actor.rollback(options)
actor.stop()
```

Keep the API XState-familiar, but avoid claiming compatibility until nested states, actors, and delayed transitions exist.

## Success Criteria

Machine V1 is successful when:

- Invalid transitions are rejected deterministically.
- Guards can block transitions.
- Context can be patched through assign rules.
- Side effects are returned as descriptors.
- Snapshots are persisted in a Gaesup store.
- Rollback restores a previous snapshot.
- DevTools or logs show a readable transition timeline.
