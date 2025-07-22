<template>
  <footer class="vue-footer">
    <div class="footer-content">
      <div class="framework-indicator">
        <span class="framework-badge">💚 Vue</span>
        <span class="framework-name">Footer Status</span>
      </div>
      
      <div class="footer-status">
        <div class="status-item">
          <span class="status-label">Status:</span>
          <span class="status-value" id="footer-status">
            {{ isLoading ? '⏳ 처리 중...' : '🚀 시스템 실행 중' }}
          </span>
        </div>
        
        <div class="status-item">
          <span class="status-label">Timestamp:</span>
          <span class="status-value" id="footer-timestamp">
            {{ currentTime }}
          </span>
        </div>
        
        <div class="status-item">
          <span class="status-label">Performance:</span>
          <span class="status-value" id="footer-performance">
            {{ avgTime }}ms
          </span>
        </div>
        
        <div class="status-item">
          <span class="status-label">State Version:</span>
          <span class="status-value">
            v{{ stateVersion }}
          </span>
        </div>
      </div>
      
      <div class="footer-actions">
        <button @click="createSnapshot" class="footer-btn">
          📸 Create Snapshot
        </button>
        
        <button @click="showHistory" class="footer-btn">
          📊 Show History
        </button>
        
        <button @click="exportState" class="footer-btn">
          💾 Export State
        </button>
      </div>
    </div>
  </footer>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { useGaesupState } from '@gaesup-state/vue';
import { 
  SHARED_STORE_ID, 
  SharedState, 
  createStateSnapshot,
  getStoreMetrics 
} from '../../stores/sharedStore';

export default defineComponent({
  name: 'VueFooter',
  setup() {
    // Gaesup-State 사용
    const { state, setState, subscribe } = useGaesupState<SharedState>(
      SHARED_STORE_ID,
      {
        count: 0,
        lastUpdated: null,
        framework: 'None',
        history: []
      }
    );
    
    // 로컬 상태
    const isLoading = ref(false);
    const currentTime = ref(new Date().toLocaleTimeString());
    const metrics = ref<any>({});
    
    // Computed
    const avgTime = computed(() => {
      return Math.round(metrics.value.avg_dispatch_time || 0);
    });
    
    const stateVersion = computed(() => {
      return state.value.history.length + 1;
    });
    
    // 시간 업데이트
    let timeInterval: number;
    let metricsInterval: number;
    
    onMounted(() => {
      // 시간 업데이트
      timeInterval = window.setInterval(() => {
        currentTime.value = new Date().toLocaleTimeString();
      }, 1000);
      
      // 메트릭스 업데이트
      const updateMetrics = async () => {
        try {
          const m = await getStoreMetrics();
          metrics.value = m;
        } catch (error) {
          console.error('Failed to get metrics:', error);
        }
      };
      
      updateMetrics();
      metricsInterval = window.setInterval(updateMetrics, 1000);
    });
    
    onUnmounted(() => {
      if (timeInterval) clearInterval(timeInterval);
      if (metricsInterval) clearInterval(metricsInterval);
    });
    
    // 액션
    const createSnapshot = async () => {
      try {
        const snapshotId = await createStateSnapshot();
        alert(`Snapshot created: ${snapshotId}`);
      } catch (error) {
        console.error('Failed to create snapshot:', error);
        alert('Failed to create snapshot');
      }
    };
    
    const showHistory = () => {
      const history = state.value.history;
      const historyText = history
        .map(h => `${h.action} by ${h.framework}: ${h.previousValue} → ${h.newValue}`)
        .join('\n');
      
      alert(`Action History (Last ${history.length} actions):\n\n${historyText}`);
    };
    
    const exportState = () => {
      const stateData = JSON.stringify(state.value, null, 2);
      const blob = new Blob([stateData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `gaesup-state-${Date.now()}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
    };
    
    return {
      state,
      isLoading,
      currentTime,
      avgTime,
      stateVersion,
      createSnapshot,
      showHistory,
      exportState
    };
  }
});
</script>

<style scoped>
.vue-footer {
  background: #1f2937;
  color: white;
  padding: 1.5rem;
  margin-top: auto;
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
}

.framework-indicator {
  margin-bottom: 1rem;
}

.framework-badge {
  font-size: 1.5rem;
  margin-right: 0.5rem;
}

.framework-name {
  font-weight: bold;
}

.footer-status {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.status-item {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.status-label {
  color: #9ca3af;
  font-size: 0.875rem;
}

.status-value {
  font-weight: bold;
}

.footer-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.footer-btn {
  padding: 0.5rem 1rem;
  background: #374151;
  color: white;
  border: 1px solid #4b5563;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.footer-btn:hover {
  background: #4b5563;
}
</style> 