import { 
  SHARED_STORE_ID, 
  subscribeToStore, 
  resetCount,
  getSharedState,
  getStoreMetrics,
  createStateSnapshot 
} from '../../stores/sharedStore';
import type { SharedState } from '../../stores/sharedStore';

// 간단한 Angular-like 컴포넌트 (실제 Angular 없이)
export class AngularSidebarComponent {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private state: SharedState;
  private systemInfo = {
    implementation: 'Rust WASM',
    containerId: SHARED_STORE_ID,
    initialized: true
  };

  constructor(element: HTMLElement) {
    this.element = element;
    this.state = getSharedState();
    this.render();
    this.attachEventListeners();
    this.subscribeToChanges();
  }

  private render() {
    this.element.innerHTML = `
      <div class="angular-sidebar">
        <div class="framework-indicator">
          <span class="framework-badge">🅰️ Angular</span>
          <span class="framework-name">Control Panel</span>
        </div>
        
        <div class="control-section">
          <h3>System Info</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Implementation:</span>
              <span class="info-value" id="sidebar-implementation">${this.systemInfo.implementation}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Container ID:</span>
              <span class="info-value" id="sidebar-container-id">${this.systemInfo.containerId}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Initialized:</span>
              <span class="info-value" id="sidebar-initialized">${this.systemInfo.initialized ? '완료' : '대기'}</span>
            </div>
          </div>
        </div>
        
        <div class="control-section">
          <h3>Quick Actions</h3>
          <div class="control-buttons">
            <button class="control-btn" id="btn-sync">
              🔄 강제 동기화
            </button>
            <button class="control-btn" id="btn-reset-all">
              🗑️ 전체 리셋
            </button>
            <button class="control-btn" id="btn-metrics">
              📊 메트릭스 보기
            </button>
            <button class="control-btn" id="btn-snapshot">
              📸 스냅샷 생성
            </button>
          </div>
        </div>
        
        <div class="control-section">
          <h3>Current State</h3>
          <div class="state-display">
            <pre>${JSON.stringify(this.state, null, 2)}</pre>
          </div>
        </div>
      </div>
    `;
  }

  private attachEventListeners() {
    // 버튼 이벤트 리스너
    const syncBtn = this.element.querySelector('#btn-sync');
    const resetAllBtn = this.element.querySelector('#btn-reset-all');
    const metricsBtn = this.element.querySelector('#btn-metrics');
    const snapshotBtn = this.element.querySelector('#btn-snapshot');

    syncBtn?.addEventListener('click', () => this.handleSync());
    resetAllBtn?.addEventListener('click', () => this.handleResetAll());
    metricsBtn?.addEventListener('click', () => this.handleShowMetrics());
    snapshotBtn?.addEventListener('click', () => this.handleSnapshot());
  }

  private subscribeToChanges() {
    this.unsubscribe = subscribeToStore((state) => {
      this.state = state;
      this.updateStateDisplay();
    });
  }

  private updateStateDisplay() {
    const stateDisplay = this.element.querySelector('.state-display pre');
    if (stateDisplay) {
      stateDisplay.textContent = JSON.stringify(this.state, null, 2);
    }
  }

  private handleSync() {
    console.log('🔄 강제 동기화 실행');
    this.state = getSharedState();
    this.updateStateDisplay();
  }

  private async handleResetAll() {
    try {
      await resetCount('Angular');
      console.log('🗑️ 모든 상태 리셋 완료');
    } catch (error) {
      console.error('전체 리셋 실패:', error);
    }
  }

  private async handleShowMetrics() {
    try {
      const metrics = await getStoreMetrics();
      const metricsInfo = {
        state: this.state,
        metrics,
        systemInfo: this.systemInfo
      };
      
      alert(`📊 상세 메트릭스:\n${JSON.stringify(metricsInfo, null, 2)}`);
    } catch (error) {
      console.error('메트릭스 조회 실패:', error);
    }
  }

  private async handleSnapshot() {
    try {
      const snapshotId = await createStateSnapshot();
      alert(`📸 스냅샷 생성 완료: ${snapshotId}`);
    } catch (error) {
      console.error('스냅샷 생성 실패:', error);
      alert('스냅샷 생성 실패');
    }
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

// CSS 스타일 추가
const style = document.createElement('style');
style.textContent = `
  .angular-sidebar {
    background: #f3f4f6;
    padding: 1.5rem;
    height: 100%;
  }

  .framework-indicator {
    margin-bottom: 1.5rem;
  }

  .framework-badge {
    font-size: 1.5rem;
    margin-right: 0.5rem;
  }

  .framework-name {
    font-weight: bold;
    color: #1f2937;
  }

  .control-section {
    margin-bottom: 2rem;
  }

  .control-section h3 {
    color: #374151;
    margin-bottom: 1rem;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem;
    background: white;
    border-radius: 4px;
  }

  .info-label {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .info-value {
    font-weight: bold;
    color: #1f2937;
  }

  .control-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .control-btn {
    padding: 0.75rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .control-btn:hover {
    background: #f9fafb;
    border-color: #d1d5db;
  }

  .state-display {
    background: white;
    padding: 1rem;
    border-radius: 6px;
    overflow: auto;
    max-height: 300px;
  }

  .state-display pre {
    margin: 0;
    font-size: 0.75rem;
    color: #374151;
  }
`;
document.head.appendChild(style); 