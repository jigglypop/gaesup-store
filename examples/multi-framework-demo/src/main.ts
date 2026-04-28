import {
  SHARED_STORE_ID,
  connectDevTools,
  getSharedState,
  getStoreMetrics,
  initializeSharedStore,
  subscribeToStore,
  type SharedState
} from './stores/sharedStore';
import { mountAngularSidebar } from './components/angular/mountAngular';
import { mountDependencyIsolationDemo } from './dependencyIsolationDemo';
import { mountReactHeader } from './components/react/ReactHeader';
import { mountSvelteMain } from './components/svelte/mountSvelte';
import { mountVueFooter } from './components/vue/mountVue';
import { GaesupCore } from 'gaesup-state';

(window as any).GaesupCore = GaesupCore;

class MultiFrameworkApp {
  private unsubscribe: (() => void) | null = null;
  private metricsInterval: number | null = null;

  async init() {
    try {
      console.log('Gaesup multi-framework demo starting');

      await initializeSharedStore();
      connectDevTools();
      this.mountAllComponents();
      mountDependencyIsolationDemo('dependency-isolation');
      this.setupPagination();

      this.unsubscribe = subscribeToStore((state) => {
        this.updateSharedStatus(state);
      });
      this.updateSharedStatus(getSharedState());
      this.startMetricsLoop();
      this.hideLoadingOverlay();

      console.log('Gaesup multi-framework demo ready');
    } catch (error) {
      console.error('Initialization failed:', error);
      this.showError(error);
    }
  }

  destroy() {
    this.unsubscribe?.();
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    GaesupCore.cleanupStore(SHARED_STORE_ID).catch(console.error);
  }

  private mountAllComponents() {
    this.mount('React', () => mountReactHeader('react-counter'));
    this.mount('Vue', () => mountVueFooter('vue-counter'));
    this.mount('Svelte', () => mountSvelteMain('svelte-counter'));
    this.mount('Angular', () => mountAngularSidebar('angular-counter'));
  }

  private setupPagination() {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-page-button]'));
    const pages = {
      counter: document.getElementById('page-counter'),
      isolation: document.getElementById('page-isolation')
    };

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const page = button.dataset.pageButton as keyof typeof pages;
        for (const [pageName, element] of Object.entries(pages)) {
          if (element) {
            element.hidden = pageName !== page;
          }
        }
        buttons.forEach((current) => {
          current.setAttribute('aria-selected', String(current === button));
        });
      });
    });
  }

  private mount(name: string, mountComponent: () => void) {
    try {
      mountComponent();
      window.setTimeout(() => this.ensureMountRendered(name), 0);
      console.log(`${name} counter mounted`);
    } catch (error) {
      console.error(`${name} counter mount failed:`, error);
      this.renderFallbackCard(name, error);
    }
  }

  private ensureMountRendered(name: string) {
    const element = document.getElementById(`${name.toLowerCase()}-counter`);
    if (element && element.childElementCount === 0) {
      this.renderFallbackCard(name, new Error(`${name} mount produced no content`));
    }
  }

  private renderFallbackCard(name: string, error: unknown) {
    const element = document.getElementById(`${name.toLowerCase()}-counter`);
    if (!element) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    element.innerHTML = `
      <article class="counter-card" style="--accent: #ef6868">
        <div>
          <div class="framework-name">${name}</div>
          <div class="card-title">마운트 실패</div>
          <p class="card-copy">${this.escapeHtml(message)}</p>
        </div>
        <div>
          <div class="count-value">-</div>
          <div class="last-update">브라우저 콘솔 없이도 실패 위치를 표시합니다.</div>
        </div>
      </article>
    `;
  }

  private updateSharedStatus(state: SharedState) {
    this.setText('shared-count', String(state.count));
    this.setText('metric-framework', state.framework);
    this.setText(
      'last-updated',
      state.lastUpdated ? new Date(state.lastUpdated).toLocaleTimeString() : 'N/A'
    );
  }

  private startMetricsLoop() {
    const update = async () => {
      const metrics = await getStoreMetrics();
      this.setText('metric-subscribers', String(metrics.subscriber_count ?? 0));
      this.setText('metric-dispatches', String(metrics.total_dispatches ?? 0));
      this.setText('metric-dispatch-time', `${Number(metrics.avg_dispatch_time ?? 0).toFixed(3)}ms`);
    };

    update().catch(console.error);
    this.metricsInterval = window.setInterval(() => {
      update().catch(console.error);
    }, 500);
  }

  private setText(id: string, value: string) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  private hideLoadingOverlay() {
    document.getElementById('loading-overlay')?.classList.add('hidden');
  }

  private showError(error: unknown) {
    const overlay = document.getElementById('loading-overlay');
    const message = error instanceof Error ? error.message : String(error);
    this.hideLoadingOverlay();

    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.innerHTML = `
        <div style="max-width: 520px; padding: 24px; text-align: center;">
          <h2 style="color: #ef4444; margin: 0 0 12px;">초기화 실패</h2>
          <p style="margin: 0 0 18px; color: #cbd5e1;">${this.escapeHtml(message)}</p>
          <button onclick="location.reload()">다시 불러오기</button>
        </div>
      `;
    }
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

let app: MultiFrameworkApp;

async function boot() {
  app = new MultiFrameworkApp();
  await app.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    boot().catch(console.error);
  }, { once: true });
} else {
  boot().catch(console.error);
}

window.addEventListener('beforeunload', () => {
  app?.destroy();
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

export { MultiFrameworkApp };
