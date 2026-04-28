import {
  decrementCount,
  getSharedState,
  incrementCount,
  resetCount,
  subscribeToStore,
  type SharedState
} from '../../stores/sharedStore';

export class AngularSidebarComponent {
  private unsubscribe: (() => void) | null = null;
  private state: SharedState;

  constructor(private readonly element: HTMLElement) {
    this.state = getSharedState();
    this.render();
    this.attachEventListeners();
    this.unsubscribe = subscribeToStore((state) => {
      this.state = state;
      this.update();
    });
  }

  destroy() {
    this.unsubscribe?.();
  }

  private render() {
    this.element.innerHTML = `
      <article class="counter-card" style="--accent: #dd0031">
        <div>
          <div class="framework-name">Angular</div>
          <div class="card-title">Class subscriber</div>
          <p class="card-copy">Uses an Angular-like class component bound to the shared store.</p>
        </div>

        <div>
          <div class="count-value" data-counter="angular">${this.state.count}</div>
          <div class="last-update" data-last-writer>Last writer: ${this.state.framework}</div>
          <div class="button-row">
            <button class="primary" data-action="angular-inc">+1</button>
            <button data-action="angular-dec">-1</button>
            <button data-action="angular-reset">Reset</button>
          </div>
        </div>
      </article>
    `;
  }

  private attachEventListeners() {
    this.element.querySelector('[data-action="angular-inc"]')?.addEventListener('click', () => {
      incrementCount('Angular').catch(console.error);
    });
    this.element.querySelector('[data-action="angular-dec"]')?.addEventListener('click', () => {
      decrementCount('Angular').catch(console.error);
    });
    this.element.querySelector('[data-action="angular-reset"]')?.addEventListener('click', () => {
      resetCount('Angular').catch(console.error);
    });
  }

  private update() {
    const count = this.element.querySelector('[data-counter="angular"]');
    const writer = this.element.querySelector('[data-last-writer]');

    if (count) {
      count.textContent = String(this.state.count);
    }

    if (writer) {
      writer.textContent = `Last writer: ${this.state.framework}`;
    }
  }
}
