// Executable showcase of the full graph plane, following the Runtime Spec
// v0.1 example containers (§69 Auth, §70 Portfolio, §30 Market stream).
// Every State Plane primitive appears here working together:
//   state / derived / batch      (§16-20)
//   graphResource                (§21-24)
//   command                      (§25-26)
//   transaction                  (§27-28)
//   graphStream                  (§29-30)
//   createGraphMesh              (§14 expose/consume)

import { describe, expect, it, vi } from 'vitest';

import { batch, derived, state, transaction } from './graph';
import { command } from './graph-command';
import { createGraphMesh } from './graph-mesh';
import { graphResource } from './graph-resource';
import { graphStream, type GraphStreamObserver } from './graph-stream';
import type { ConsumedNode } from './graph-mesh';

interface User {
  id: number;
  name: string;
}

interface Asset {
  symbol: string;
  quantity: number;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// §69 Auth container: state + derived + commands, exposed through the mesh
// ---------------------------------------------------------------------------
function buildAuthContainer(mesh: ReturnType<typeof createGraphMesh>, api: {
  login: (name: string) => Promise<User>;
  logout: () => Promise<void>;
}) {
  const user = state<User | null>(null);
  const authenticated = derived(() => user.get() !== null);

  const login = command({
    execute: (name: string) => api.login(name),
    commit: (result) => user.set(result)
  });

  const logout = command({
    execute: () => api.logout(),
    commit: () => user.set(null)
  });

  mesh.expose('auth', { user, authenticated, login, logout });
  return { user, authenticated, login, logout };
}

// ---------------------------------------------------------------------------
// §30 Market container: realtime price stream, exposed through the mesh
// ---------------------------------------------------------------------------
function buildMarketContainer(mesh: ReturnType<typeof createGraphMesh>) {
  let observer: GraphStreamObserver<number> | null = null;
  const price = graphStream<number>({
    subscribe(next) {
      observer = next;
      return () => {
        observer = null;
      };
    }
  });

  mesh.expose('market', { price });
  return { price, pushPrice: (value: number) => observer?.next(value) };
}

// ---------------------------------------------------------------------------
// §70 Portfolio container: consumes auth.user, resource keyed by consumed
// state, derived total combining resource data with the market stream
// ---------------------------------------------------------------------------
function buildPortfolioContainer(
  mesh: ReturnType<typeof createGraphMesh>,
  fetchPortfolio: (userId: number | undefined, account: string | null) => Promise<Asset[]>
) {
  const user = mesh.consume<ConsumedNode<User | null>>('auth.user', { consumer: 'portfolio' });
  const price = mesh.consume<ReturnType<typeof graphStream<number>>>('market.price', {
    consumer: 'portfolio'
  });

  const selectedAccount = state<string | null>(null);

  // §71: no useEffect — the key tracks user/account, changes trigger refetch.
  const portfolio = graphResource({
    key: () => ['portfolio', user.get()?.id, selectedAccount.get()],
    fetch: async ([, userId, account]) =>
      fetchPortfolio(userId as number | undefined, account as string | null)
  });

  const total = derived(() => {
    const assets = portfolio.get().data ?? [];
    const unit = price.get() ?? 0;
    return assets.reduce((sum, asset) => sum + asset.quantity * unit, 0);
  });

  return { selectedAccount, portfolio, total };
}

describe('spec scenario: auth + market + portfolio over one graph', () => {
  function setup() {
    const mesh = createGraphMesh();
    const auth = buildAuthContainer(mesh, {
      login: async (name) => ({ id: 42, name }),
      logout: async () => {}
    });
    const market = buildMarketContainer(mesh);
    const fetchPortfolio = vi.fn(async (userId: number | undefined) =>
      userId === undefined ? [] : [{ symbol: 'BTC', quantity: 2 }, { symbol: 'ETH', quantity: 10 }]
    );
    const portfolio = buildPortfolioContainer(mesh, fetchPortfolio);
    return { mesh, auth, market, portfolio, fetchPortfolio };
  }

  it('runs the full flow: login -> refetch -> stream tick -> derived total -> UI notification', async () => {
    const { auth, market, portfolio } = setup();

    // A view subscribes to the derived total (§84: only affected views notified).
    const rendered: number[] = [];
    portfolio.total.subscribe((value) => rendered.push(value));
    await tick();
    expect(portfolio.total.get()).toBe(0); // anonymous: empty portfolio, no price

    // Command commits into auth.user; the portfolio resource key sees the new
    // user id and refetches automatically — no effect wiring anywhere.
    await auth.login('ada');
    expect(auth.authenticated.get()).toBe(true);
    await tick();
    expect(portfolio.portfolio.get().data).toHaveLength(2);

    // A realtime price lands in the same graph: total = (2 + 10) * price.
    market.pushPrice(100);
    expect(portfolio.total.get()).toBe(1200);
    market.pushPrice(150);
    expect(portfolio.total.get()).toBe(1800);
    expect(rendered).toContain(1200);
    expect(rendered).toContain(1800);
  });

  it('refetches when the selected account changes and rolls back failed commands', async () => {
    const { auth, portfolio, fetchPortfolio } = setup();
    await auth.login('ada');
    portfolio.portfolio.subscribe(() => {});
    await tick();
    const callsAfterLogin = fetchPortfolio.mock.calls.length;

    portfolio.selectedAccount.set('NH002'); // §22: key change -> new fetch
    expect(fetchPortfolio.mock.calls.length).toBe(callsAfterLogin + 1);

    // §26: optimistic account switch that the server rejects rolls back.
    const switchAccount = command({
      optimistic: (account: string) => portfolio.selectedAccount.set(account),
      execute: async () => {
        throw new Error('account locked');
      }
    });
    await expect(switchAccount('NH003')).rejects.toThrow('account locked');
    expect(portfolio.selectedAccount.get()).toBe('NH002');
  });

  it('keeps multi-write updates atomic with transaction and batch', () => {
    const balanceA = state(100);
    const balanceB = state(0);
    const totalBalance = derived(() => balanceA.get() + balanceB.get());
    const listener = vi.fn();
    totalBalance.subscribe(listener);

    // §27: observers never see the intermediate state of a transfer.
    transaction(() => {
      balanceA.set(balanceA.get() - 40);
      balanceB.set(balanceB.get() + 40);
    });
    expect(listener).not.toHaveBeenCalled(); // total unchanged: no glitch, no notify

    // §20: batch collapses multiple writes into one notification wave.
    batch(() => {
      balanceA.set(10);
      balanceB.set(20);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(30);
  });

  it('enforces the container contracts from §9/§14 at the mesh boundary', () => {
    const { mesh } = setup();

    // Reading is open; mutation is not exposed (invariant I2).
    const consumedUser = mesh.consume<ConsumedNode<User | null>>('auth.user');
    expect((consumedUser as any).set).toBeUndefined();

    // Unknown dependencies fail closed; optional ones degrade gracefully (§44).
    expect(() => mesh.consume('auth.secret')).toThrowError(/GAESUP_DEPENDENCY_UNAVAILABLE/);
    expect(mesh.consume('reco.data', { required: false })).toBeUndefined();

    // The runtime can see who depends on what (§13, principle 6).
    expect(mesh.dependencies()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'auth.user', consumer: 'portfolio' }),
        expect.objectContaining({ address: 'market.price', consumer: 'portfolio' })
      ])
    );
  });
});
