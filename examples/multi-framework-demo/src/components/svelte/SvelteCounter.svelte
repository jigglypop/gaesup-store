<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { SharedContainerManager, SharedStateEvent } from '../../shared/SharedContainerManager';

  interface CounterState {
    count: number;
    lastUpdated: number;
    framework: string;
  }

  // 반응형 상태
  let containerState: CounterState = {
    count: 0,
    lastUpdated: Date.now(),
    framework: 'none'
  };

  let loading = false;
  let containerId = '';
  let metrics: any = null;

  // 공유 매니저 인스턴스
  const sharedManager = SharedContainerManager.getInstance();

  // 상태 변경 이벤트 핸들러
  const handleStateChange = (event: CustomEvent<SharedStateEvent>) => {
    const { type, containerId: eventContainerId, data } = event.detail;
    
    if (type === 'stateChange' && eventContainerId === containerId) {
      const newState = sharedManager.getContainerState(containerId);
      if (newState) {
        containerState = { ...newState };
      }
      
      // 메트릭스 업데이트
      metrics = sharedManager.getContainerMetrics(containerId);
    }
  };

  // 컨테이너 초기화
  const initContainer = async () => {
    try {
      loading = true;
      
      // 공유 컨테이너가 이미 있는지 확인
      const existingContainers = sharedManager.getAllContainers();
      let targetContainerId = '';
      
      if (existingContainers.length > 0) {
        // 기존 컨테이너 재사용
        targetContainerId = existingContainers[0].id;
      } else {
        // 새 컨테이너 생성
        targetContainerId = await sharedManager.createContainer({
          name: 'shared-counter',
          wasmUrl: '/wasm/counter.wasm',
          initialState: {
            count: 0,
            lastUpdated: Date.now(),
            framework: 'svelte'
          },
          memoryLimit: 64 * 1024 * 1024, // 64MB
          enableMetrics: true
        });
      }
      
      containerId = targetContainerId;
      
      // 초기 상태 설정
      const initialState = sharedManager.getContainerState(targetContainerId);
      if (initialState) {
        containerState = { ...initialState };
      }
      
      // 초기 메트릭스 설정
      metrics = sharedManager.getContainerMetrics(targetContainerId);
      
    } catch (error) {
      console.error('Svelte 컨테이너 초기화 실패:', error);
    } finally {
      loading = false;
    }
  };

  // 컨테이너 함수들
  const increment = async () => {
    if (!containerId) return;
    
    try {
      loading = true;
      await sharedManager.callContainerFunction(containerId, 'increment', 'svelte');
    } catch (error) {
      console.error('Increment 실패:', error);
    } finally {
      loading = false;
    }
  };

  const decrement = async () => {
    if (!containerId) return;
    
    try {
      loading = true;
      await sharedManager.callContainerFunction(containerId, 'decrement', 'svelte');
    } catch (error) {
      console.error('Decrement 실패:', error);
    } finally {
      loading = false;
    }
  };

  const reset = async () => {
    if (!containerId) return;
    
    try {
      loading = true;
      await sharedManager.callContainerFunction(containerId, 'reset', 'svelte');
    } catch (error) {
      console.error('Reset 실패:', error);
    } finally {
      loading = false;
    }
  };

  // 유틸리티 함수들
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatMemory = (bytes: number) => {
    return (bytes / 1024).toFixed(1);
  };

  // 라이프사이클
  onMount(() => {
    window.addEventListener('gaesup:stateChange', handleStateChange as EventListener);
    initContainer();
  });

  onDestroy(() => {
    window.removeEventListener('gaesup:stateChange', handleStateChange as EventListener);
  });
</script>

<div class="framework-component svelte-component">
  <div class="framework-header">
    <h3>🔥 Svelte Component</h3>
    <span class="framework-badge svelte">Svelte 4</span>
  </div>
  
  <div class="counter-display">
    <div class="count-value">{containerState.count}</div>
    <div class="count-info">
      <small>마지막 업데이트: {containerState.framework}</small>
      <br />
      <small>시간: {formatTime(containerState.lastUpdated)}</small>
    </div>
  </div>

  <div class="counter-controls">
    <button 
      on:click={decrement} 
      disabled={loading}
      class="btn btn-secondary"
    >
      -1
    </button>
    <button 
      on:click={increment} 
      disabled={loading}
      class="btn btn-primary"
    >
      +1
    </button>
    <button 
      on:click={reset} 
      disabled={loading}
      class="btn btn-danger"
    >
      Reset
    </button>
  </div>

  {#if metrics}
  <div class="metrics-display">
    <h4>📊 컨테이너 메트릭스</h4>
    <div class="metrics-grid">
      <div class="metric">
        <span>메모리 사용:</span>
        <span>{formatMemory(metrics.memoryUsage?.used || 0)}KB</span>
      </div>
      <div class="metric">
        <span>함수 호출:</span>
        <span>{metrics.functionCalls || 0}</span>
      </div>
      <div class="metric">
        <span>실행 시간:</span>
        <span>{metrics.executionTime || 0}ms</span>
      </div>
    </div>
  </div>
  {/if}

  <div class="container-info">
    <small>Container ID: {containerId}</small>
    {#if loading}
    <div class="loading-indicator">처리 중...</div>
    {/if}
  </div>
</div>

<style>
  .svelte-component {
    border: 2px solid #FF3E00;
    background: linear-gradient(135deg, #fff4f0 0%, #ffe8e0 100%);
  }

  .framework-badge.svelte {
    background: #FF3E00;
    color: white;
  }

  .count-value {
    color: #FF3E00;
    text-shadow: 0 2px 4px rgba(255, 62, 0, 0.3);
  }

  .btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(255, 62, 0, 0.3);
  }

  .framework-component {
    padding: 20px;
    margin: 10px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  .framework-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .framework-header h3 {
    margin: 0;
    font-size: 1.5rem;
  }

  .framework-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: bold;
  }

  .counter-display {
    text-align: center;
    margin-bottom: 20px;
  }

  .count-value {
    font-size: 3rem;
    font-weight: bold;
    margin-bottom: 10px;
  }

  .count-info {
    opacity: 0.7;
  }

  .counter-controls {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 20px;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #007bff;
    color: white;
  }

  .btn-secondary {
    background: #6c757d;
    color: white;
  }

  .btn-danger {
    background: #dc3545;
    color: white;
  }

  .metrics-display {
    margin: 20px 0;
    padding: 15px;
    background: rgba(255, 255, 255, 0.5);
    border-radius: 8px;
  }

  .metrics-display h4 {
    margin: 0 0 10px 0;
    font-size: 1rem;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }

  .metric {
    display: flex;
    flex-direction: column;
    text-align: center;
  }

  .metric span:first-child {
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .metric span:last-child {
    font-weight: bold;
    font-size: 1.1rem;
  }

  .container-info {
    text-align: center;
    font-size: 0.8rem;
    opacity: 0.6;
  }

  .loading-indicator {
    margin-top: 5px;
    font-style: italic;
    color: #007bff;
  }
</style> 