import { describe, expect, it, vi } from 'vitest';

import { derived, state } from './graph';
import { GraphRuntimeError, createRuntime, defineContainer } from './graph-runtime';
import type { ConsumedNode } from './graph-mesh';

const authContainer = () =>
  defineContainer({
    name: 'auth',
    version: '1.0.0',
    setup() {
      const user = state<string | null>(null);
      const authenticated = derived(() => user.get() !== null);
      return {
        user,
        exposes: { user, authenticated, login: (name: string) => user.set(name) }
      };
    }
  });

describe('container lifecycle', () => {
  it('registers as CREATED and walks to ACTIVE on start', () => {
    const runtime = createRuntime();
    runtime.register(authContainer());
    expect(runtime.status('auth')).toBe('CREATED');

    runtime.start('auth');
    expect(runtime.status('auth')).toBe('ACTIVE');
    expect(runtime.containers()).toEqual([
      { name: 'auth', version: '1.0.0', status: 'ACTIVE' }
    ]);
  });

  it('exposes the setup interface through the runtime mesh', () => {
    const runtime = createRuntime();
    runtime.register(authContainer());
    runtime.start('auth');

    const login = runtime.consume<(name: string) => void>('auth.login');
    login('ada');
    expect(runtime.consume<ConsumedNode<string | null>>('auth.user').get()).toBe('ada');
    expect(runtime.consume<ConsumedNode<boolean>>('auth.authenticated').get()).toBe(true);
  });

  it('supports suspend/resume and stop/destroy transitions', () => {
    const runtime = createRuntime();
    runtime.register(authContainer());
    runtime.start('auth');

    runtime.suspend('auth');
    expect(runtime.status('auth')).toBe('SUSPENDED');
    runtime.resume('auth');
    expect(runtime.status('auth')).toBe('ACTIVE');

    runtime.stop('auth');
    expect(runtime.status('auth')).toBe('STOPPED');
    runtime.destroy('auth');
    expect(runtime.status('auth')).toBe('DESTROYED');
  });

  it('destroy removes the exposed namespace from the mesh', () => {
    const runtime = createRuntime();
    runtime.register(authContainer());
    runtime.start('auth');
    runtime.stop('auth');
    runtime.destroy('auth');

    expect(() => runtime.consume('auth.user')).toThrowError(/GAESUP_DEPENDENCY_UNAVAILABLE/);
  });

  it('fail-closed: undefined lifecycle transitions are rejected (invariant I5)', () => {
    const runtime = createRuntime();
    runtime.register(authContainer());

    for (const op of [
      () => runtime.resume('auth'), // CREATED -> resume
      () => runtime.suspend('auth'), // CREATED -> suspend
      () => runtime.stop('auth') // CREATED -> stop
    ]) {
      try {
        op();
        expect.unreachable('must throw');
      } catch (error) {
        expect((error as GraphRuntimeError).code).toBe('GAESUP_INVALID_TRANSITION');
      }
    }

    runtime.start('auth');
    runtime.start('auth'); // idempotent, not a transition error
    expect(runtime.status('auth')).toBe('ACTIVE');
  });

  it('throws for unknown containers', () => {
    const runtime = createRuntime();
    try {
      runtime.start('ghost');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as GraphRuntimeError).code).toBe('GAESUP_CONTAINER_NOT_FOUND');
    }
  });
});

describe('dependency resolution and startup ordering', () => {
  it('starts declared dependencies first (§73-74)', () => {
    const order: string[] = [];
    const runtime = createRuntime();
    runtime.register(defineContainer({ name: 'auth', setup: () => (order.push('auth'), {}) }));
    runtime.register(defineContainer({ name: 'market', setup: () => (order.push('market'), {}) }));
    runtime.register(
      defineContainer({
        name: 'portfolio',
        dependencies: ['auth', 'market'],
        setup: () => (order.push('portfolio'), {})
      })
    );

    runtime.start('portfolio');
    expect(order).toEqual(['auth', 'market', 'portfolio']);
    expect(runtime.status('auth')).toBe('ACTIVE');
  });

  it('startAll starts every container in topological order', () => {
    const order: string[] = [];
    const runtime = createRuntime();
    runtime.register(
      defineContainer({ name: 'dashboard', dependencies: ['portfolio'], setup: () => (order.push('dashboard'), {}) })
    );
    runtime.register(
      defineContainer({ name: 'portfolio', dependencies: ['auth'], setup: () => (order.push('portfolio'), {}) })
    );
    runtime.register(defineContainer({ name: 'auth', setup: () => (order.push('auth'), {}) }));

    runtime.startAll();
    expect(order).toEqual(['auth', 'portfolio', 'dashboard']);
  });

  it('fail-closed: dependency cycles are rejected (§13)', () => {
    const runtime = createRuntime();
    runtime.register(defineContainer({ name: 'a', dependencies: ['b'], setup: () => ({}) }));
    runtime.register(defineContainer({ name: 'b', dependencies: ['a'], setup: () => ({}) }));

    try {
      runtime.start('a');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as GraphRuntimeError).code).toBe('GAESUP_DEPENDENCY_CYCLE');
    }
  });
});

describe('failure isolation and health (§42-44)', () => {
  it('a setup crash marks the container FAILED without touching the others', () => {
    const runtime = createRuntime();
    const errors: Array<{ container: string; phase: string }> = [];
    runtime.onContainerError((error) => errors.push({ container: error.container, phase: error.phase }));

    runtime.register(defineContainer({ name: 'auth', setup: () => ({}) }));
    runtime.register(
      defineContainer({
        name: 'chat',
        setup: () => {
          throw new Error('chat exploded');
        }
      })
    );

    runtime.startAll();
    expect(runtime.status('auth')).toBe('ACTIVE');
    expect(runtime.status('chat')).toBe('FAILED');
    expect(runtime.health('chat')).toBe('failed');
    expect(errors).toEqual([{ container: 'chat', phase: 'setup' }]);
  });

  it('a container requiring a failed dependency fails too; optional consumers degrade', () => {
    const runtime = createRuntime();
    runtime.onContainerError(() => {});
    runtime.register(
      defineContainer({
        name: 'auth',
        setup: () => {
          throw new Error('auth down');
        }
      })
    );
    runtime.register(
      defineContainer({
        name: 'portfolio',
        dependencies: ['auth'],
        setup: ({ consume }) => ({ user: consume('auth.user') })
      })
    );
    runtime.register(
      defineContainer({
        name: 'home',
        setup: ({ consume }) => ({ reco: consume('reco.feed', { required: false }) })
      })
    );

    runtime.startAll();
    expect(runtime.status('auth')).toBe('FAILED');
    expect(runtime.status('portfolio')).toBe('FAILED');
    expect(runtime.status('home')).toBe('ACTIVE');
    expect(runtime.health('home')).toBe('degraded'); // optional dep missing
  });

  it('reports healthy for an ACTIVE container with all dependencies ACTIVE', () => {
    const runtime = createRuntime();
    runtime.register(defineContainer({ name: 'auth', setup: () => ({ exposes: { user: state(null) } }) }));
    runtime.register(
      defineContainer({
        name: 'portfolio',
        dependencies: ['auth'],
        setup: ({ consume }) => ({ user: consume('auth.user') })
      })
    );
    runtime.startAll();

    expect(runtime.health('auth')).toBe('healthy');
    expect(runtime.health('portfolio')).toBe('healthy');
  });
});

describe('container context', () => {
  it('passes env and container identity into setup', () => {
    const seen = vi.fn();
    const runtime = createRuntime({ env: { API_URL: 'https://api.example.com' } });
    runtime.register(
      defineContainer({
        name: 'auth',
        version: '2.0.0',
        setup: (ctx) => {
          seen(ctx.env.API_URL, ctx.container.name, ctx.container.version);
          return {};
        }
      })
    );
    runtime.start('auth');

    expect(seen).toHaveBeenCalledWith('https://api.example.com', 'auth', '2.0.0');
  });
});
