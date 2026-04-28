import './polyfills/wasm-polyfill';
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
import { mountReactHeader } from './components/react/ReactHeader';
import { mountSvelteMain } from './components/svelte/mountSvelte';
import { mountVueFooter } from './components/vue/mountVue';
import { GaesupCore } from '@gaesup-state/core';

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

  private mount(name: string, mountComponent: () => void) {
    try {
      mountComponent();
      console.log(`${name} counter mounted`);
    } catch (error) {
      console.error(`${name} counter mount failed:`, error);
    }
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

    if (overlay) {
      overlay.innerHTML = `
        <div style="max-width: 520px; padding: 24px; text-align: center;">
          <h2 style="color: #ef4444; margin: 0 0 12px;">Initialization failed</h2>
          <p style="margin: 0 0 18px; color: #cbd5e1;">${message}</p>
          <button onclick="location.reload()">Reload</button>
        </div>
      `;
    }
  }
}

let app: MultiFrameworkApp;

document.addEventListener('DOMContentLoaded', async () => {
  app = new MultiFrameworkApp();
  await app.init();
});

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
