<template>
  <div class="framework-component vue-component">
    <div class="framework-header">
      <h3>💚 Vue Component</h3>
      <span class="framework-badge vue">Vue 3</span>
    </div>
    
    <div class="counter-display">
      <div class="count-value">{{ containerState.count }}</div>
      <div class="count-info">
        <small>마지막 업데이트: {{ containerState.framework }}</small>
        <br />
        <small>시간: {{ formatTime(containerState.lastUpdated) }}</small>
      </div>
    </div>

    <div class="counter-controls">
      <button 
        @click="decrement" 
        :disabled="loading"
        class="btn btn-secondary"
      >
        -1
      </button>
      <button 
        @click="increment" 
        :disabled="loading"
        class="btn btn-primary"
      >
        +1
      </button>
      <button 
        @click="reset" 
        :disabled="loading"
        class="btn btn-danger"
      >
        Reset
      </button>
    </div>

    <div v-if="metrics" class="metrics-display">
      <h4>📊 컨테이너 메트릭스</h4>
      <div class="metrics-grid">
        <div class="metric">
          <span>메모리 사용:</span>
          <span>{{ formatMemory(metrics.memoryUsage?.used || 0) }}KB</span>
        </div>
        <div class="metric">
          <span>함수 호출:</span>
          <span>{{ metrics.functionCalls || 0 }}</span>
        </div>
        <div class="metric">
          <span>실행 시간:</span>
          <span>{{ metrics.executionTime || 0 }}ms</span>
        </div>
      </div>
    </div>

    <div class="container-info">
      <small>Container ID: {{ containerId }}</small>
      <div v-if="loading" class="loading-indicator">처리 중...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { SharedContainerManager, SharedStateEvent } from '../../shared/SharedContainerManager';

interface CounterState {
  count: number;
  lastUpdated: number;
  framework: string;
}

// 반응형 상태
const containerState = reactive<CounterState>({
  count: 0,
  lastUpdated: Date.now(),
  framework: 'none'
});

const loading = ref(false);
const containerId = ref('');
const metrics = ref<any>(null);

// 공유 매니저 인스턴스
const sharedManager = SharedContainerManager.getInstance();

// 상태 변경 이벤트 핸들러
const handleStateChange = (event: CustomEvent<SharedStateEvent>) => {
  const { type, containerId: eventContainerId, data } = event.detail;
  
  if (type === 'stateChange' && eventContainerId === containerId.value) {
    const newState = sharedManager.getContainerState(containerId.value);
    if (newState) {
      Object.assign(containerState, newState);
    }
    
    // 메트릭스 업데이트
    const newMetrics = sharedManager.getContainerMetrics(containerId.value);
    metrics.value = newMetrics;
  }
};

// 컨테이너 초기화
const initContainer = async () => {
  try {
    loading.value = true;
    
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
          framework: 'vue'
        },
        memoryLimit: 64 * 1024 * 1024, // 64MB
        enableMetrics: true
      });
    }
    
    containerId.value = targetContainerId;
    
    // 초기 상태 설정
    const initialState = sharedManager.getContainerState(targetContainerId);
    if (initialState) {
      Object.assign(containerState, initialState);
    }
    
    // 초기 메트릭스 설정
    const initialMetrics = sharedManager.getContainerMetrics(targetContainerId);
    metrics.value = initialMetrics;
    
  } catch (error) {
    console.error('Vue 컨테이너 초기화 실패:', error);
  } finally {
    loading.value = false;
  }
};

// 컨테이너 함수들
const increment = async () => {
  if (!containerId.value) return;
  
  try {
    loading.value = true;
    await sharedManager.callContainerFunction(containerId.value, 'increment', 'vue');
  } catch (error) {
    console.error('Increment 실패:', error);
  } finally {
    loading.value = false;
  }
};

const decrement = async () => {
  if (!containerId.value) return;
  
  try {
    loading.value = true;
    await sharedManager.callContainerFunction(containerId.value, 'decrement', 'vue');
  } catch (error) {
    console.error('Decrement 실패:', error);
  } finally {
    loading.value = false;
  }
};

const reset = async () => {
  if (!containerId.value) return;
  
  try {
    loading.value = true;
    await sharedManager.callContainerFunction(containerId.value, 'reset', 'vue');
  } catch (error) {
    console.error('Reset 실패:', error);
  } finally {
    loading.value = false;
  }
};

// 유틸리티 함수들
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatMemory = (bytes: number) => {
  return (bytes / 1024).toFixed(1);
};

// 라이프사이클 훅
onMounted(() => {
  window.addEventListener('gaesup:stateChange', handleStateChange as EventListener);
  initContainer();
});

onUnmounted(() => {
  window.removeEventListener('gaesup:stateChange', handleStateChange as EventListener);
});
</script>

<style scoped>
.vue-component {
  border: 2px solid #4FC08D;
  background: linear-gradient(135deg, #f0f9f0 0%, #e8f5e8 100%);
}

.framework-badge.vue {
  background: #4FC08D;
  color: white;
}

.count-value {
  color: #4FC08D;
  text-shadow: 0 2px 4px rgba(79, 192, 141, 0.3);
}

.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(79, 192, 141, 0.3);
}
</style> 