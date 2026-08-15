import { describe, expect, it, vi } from 'vitest';

import { derived } from './graph';
import { graphStream, type GraphStreamObserver } from './graph-stream';

function fakeSocket<T>() {
  let observer: GraphStreamObserver<T> | null = null;
  const teardown = vi.fn(() => {
    observer = null;
  });
  return {
    subscribeCalls: 0,
    subscribe(next: GraphStreamObserver<T>) {
      this.subscribeCalls += 1;
      observer = next;
      return teardown;
    },
    push(value: T) {
      observer?.next(value);
    },
    fail(error: unknown) {
      observer?.error(error);
    },
    teardown
  };
}

describe('graphStream', () => {
  it('is lazy: connects to the source on first subscriber, then streams values', () => {
    const socket = fakeSocket<number>();
    const prices = graphStream<number>({ subscribe: (observer) => socket.subscribe(observer) });

    expect(socket.subscribeCalls).toBe(0);

    const listener = vi.fn();
    prices.subscribe(listener);
    expect(socket.subscribeCalls).toBe(1);
    expect(prices.status()).toBe('active');

    socket.push(100);
    socket.push(101);

    expect(listener).toHaveBeenNthCalledWith(1, 100);
    expect(listener).toHaveBeenNthCalledWith(2, 101);
    expect(prices.get()).toBe(101);
  });

  it('feeds the dependency graph: derived over a stream recomputes per event', () => {
    const socket = fakeSocket<number>();
    const price = graphStream<number>({ subscribe: (observer) => socket.subscribe(observer) });
    const doubled = derived(() => (price.get() ?? 0) * 2);
    const listener = vi.fn();
    doubled.subscribe(listener);

    socket.push(10);
    socket.push(25);

    expect(listener).toHaveBeenNthCalledWith(1, 20);
    expect(listener).toHaveBeenNthCalledWith(2, 50);
  });

  it('fail-closed: a source error surfaces status/error, tears down, and stops updates', () => {
    const socket = fakeSocket<number>();
    const prices = graphStream<number>({ subscribe: (observer) => socket.subscribe(observer) });
    prices.subscribe(() => {});

    socket.push(1);
    socket.fail(new Error('socket dropped'));

    expect(prices.status()).toBe('error');
    expect((prices.error() as Error).message).toBe('socket dropped');
    expect(prices.get()).toBe(1);
    expect(socket.teardown).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: a source that throws on subscribe yields status error, not a crash later', () => {
    const stream = graphStream<number>({
      subscribe: () => {
        throw new Error('cannot connect');
      }
    });

    stream.connect();
    expect(stream.status()).toBe('error');
    expect((stream.error() as Error).message).toBe('cannot connect');
  });

  it('disconnect tears down and ignores late events from a sloppy source', () => {
    let captured: GraphStreamObserver<number> | null = null;
    const teardown = vi.fn(); // deliberately does NOT clear captured
    const prices = graphStream<number>({
      subscribe: (observer) => {
        captured = observer;
        return teardown;
      }
    });
    const listener = vi.fn();
    prices.subscribe(listener);

    captured!.next(1);
    prices.disconnect();
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(prices.status()).toBe('closed');

    captured!.next(2); // late event after disconnect
    expect(prices.get()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reconnects after disconnect and resumes streaming', () => {
    const socket = fakeSocket<number>();
    const prices = graphStream<number>({ subscribe: (observer) => socket.subscribe(observer) });
    prices.subscribe(() => {});
    socket.push(1);

    prices.disconnect();
    prices.connect();
    expect(socket.subscribeCalls).toBe(2);
    expect(prices.status()).toBe('active');

    socket.push(7);
    expect(prices.get()).toBe(7);
  });

  it('connect is idempotent while active', () => {
    const socket = fakeSocket<number>();
    const prices = graphStream<number>({ subscribe: (observer) => socket.subscribe(observer) });
    prices.subscribe(() => {});
    prices.connect();
    prices.connect();

    expect(socket.subscribeCalls).toBe(1);
  });
});
