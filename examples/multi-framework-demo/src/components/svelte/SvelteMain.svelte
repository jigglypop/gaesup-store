<script lang="ts">
  import { gaesupStore } from '@gaesup-state/svelte';
  import { SHARED_STORE_ID, incrementCount, decrementCount, resetCount } from '../../stores/sharedStore';
  import type { SharedState } from '../../stores/sharedStore';
  
  // Gaesup-State 스토어 사용
  const store = gaesupStore<SharedState>(SHARED_STORE_ID, {
    count: 0,
    lastUpdated: null,
    framework: 'None',
    history: []
  });
  
  // 메트릭스 스토어
  const metrics = gaesupStore<any>('metrics', {});
  
  // 버튼 상태
  let isLoading = false;
  
  // 액션 핸들러
  async function handleIncrement() {
    isLoading = true;
    try {
      await incrementCount('Svelte');
    } catch (error) {
      console.error('Increment failed:', error);
    } finally {
      isLoading = false;
    }
  }
  
  async function handleDecrement() {
    isLoading = true;
    try {
      await decrementCount('Svelte');
    } catch (error) {
      console.error('Decrement failed:', error);
    } finally {
      isLoading = false;
    }
  }
  
  async function handleReset() {
    isLoading = true;
    try {
      await resetCount('Svelte');
    } catch (error) {
      console.error('Reset failed:', error);
    } finally {
      isLoading = false;
    }
  }
  
  // 메트릭스 업데이트
  setInterval(async () => {
    try {
      const m = await (window as any).GaesupCore.getMetrics(SHARED_STORE_ID);
      metrics.set(m || {});
    } catch (error) {
      // 무시
    }
  }, 1000);
</script>

<div class="svelte-main">
  <div class="framework-indicator">
    <span class="framework-badge">🔥 Svelte</span>
    <span class="framework-name">Main Content</span>
  </div>
  
  <div class="counter-section">
    <h2>Counter Control</h2>
    <div class="counter-display">
      <span class="counter-value" id="main-count">{$store.count}</span>
    </div>
    
    <div class="counter-controls">
      <button 
        class="btn btn-primary" 
        id="btn-increment"
        on:click={handleIncrement}
        disabled={isLoading}
      >
        ➕ Increment
      </button>
      
      <button 
        class="btn btn-secondary" 
        id="btn-decrement"
        on:click={handleDecrement}
        disabled={isLoading}
      >
        ➖ Decrement
      </button>
      
      <button 
        class="btn btn-danger" 
        id="btn-reset"
        on:click={handleReset}
        disabled={isLoading}
      >
        🔄 Reset
      </button>
    </div>
    
    <div class="last-updated">
      Last Updated: 
      <span id="main-last-updated">
        {$store.lastUpdated ? new Date($store.lastUpdated).toLocaleTimeString() : 'N/A'}
      </span>
    </div>
  </div>
  
  <div class="metrics-section">
    <h3>Performance Metrics</h3>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Memory Usage</div>
        <div class="metric-value" id="metric-memory">
          {Math.round(($metrics.memory_usage || 0) / 1024)}KB
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Function Calls</div>
        <div class="metric-value" id="metric-calls">
          {$metrics.total_dispatches || 0}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Avg Time</div>
        <div class="metric-value" id="metric-time">
          {Math.round($metrics.avg_dispatch_time || 0)}ms
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Subscriptions</div>
        <div class="metric-value" id="metric-uptime">
          {$metrics.total_subscriptions || 0}
        </div>
      </div>
    </div>
  </div>
  
  <div class="history-section">
    <h3>Recent Actions</h3>
    <div class="history-list">
      {#each $store.history.slice(-5).reverse() as entry}
        <div class="history-item">
          <span class="history-action">{entry.action}</span>
          <span class="history-framework">[{entry.framework}]</span>
          <span class="history-change">
            {entry.previousValue} → {entry.newValue}
          </span>
          <span class="history-time">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .svelte-main {
    padding: 1rem;
  }

  .framework-indicator {
    margin-bottom: 1.5rem;
  }

  .counter-section {
    background: #f3f4f6;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .counter-display {
    text-align: center;
    margin: 1.5rem 0;
  }

  .counter-value {
    font-size: 4rem;
    font-weight: bold;
    color: #1f2937;
  }

  .counter-controls {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }

  .btn-secondary {
    background: #6b7280;
    color: white;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .metric-card {
    background: white;
    padding: 1rem;
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  .metric-value {
    font-size: 1.5rem;
    font-weight: bold;
    color: #3b82f6;
  }

  .history-list {
    margin-top: 1rem;
  }

  .history-item {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    background: #f9fafb;
    margin-bottom: 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .history-action {
    font-weight: bold;
  }

  .history-framework {
    color: #6b7280;
  }

  .history-change {
    color: #3b82f6;
  }

  .history-time {
    margin-left: auto;
    color: #9ca3af;
  }
</style> 