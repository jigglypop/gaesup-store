import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedContainerManager, SharedStateEvent } from '../../shared/SharedContainerManager';

interface CounterState {
  count: number;
  lastUpdated: number;
  framework: string;
}

@Component({
  selector: 'app-angular-counter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="framework-component angular-component">
      <div class="framework-header">
        <h3>🅰️ Angular Component</h3>
        <span class="framework-badge angular">Angular 17</span>
      </div>
      
      <div class="counter-display">
        <div class="count-value">{{ containerState().count }}</div>
        <div class="count-info">
          <small>마지막 업데이트: {{ containerState().framework }}</small>
          <br />
          <small>시간: {{ formatTime(containerState().lastUpdated) }}</small>
        </div>
      </div>

      <div class="counter-controls">
        <button 
          (click)="decrement()" 
          [disabled]="loading()"
          class="btn btn-secondary"
        >
          -1
        </button>
        <button 
          (click)="increment()" 
          [disabled]="loading()"
          class="btn btn-primary"
        >
          +1
        </button>
        <button 
          (click)="reset()" 
          [disabled]="loading()"
          class="btn btn-danger"
        >
          Reset
        </button>
      </div>

      <div *ngIf="metrics()" class="metrics-display">
        <h4>📊 컨테이너 메트릭스</h4>
        <div class="metrics-grid">
          <div class="metric">
            <span>메모리 사용:</span>
            <span>{{ formatMemory(metrics()?.memoryUsage?.used || 0) }}KB</span>
          </div>
          <div class="metric">
            <span>함수 호출:</span>
            <span>{{ metrics()?.functionCalls || 0 }}</span>
          </div>
          <div class="metric">
            <span>실행 시간:</span>
            <span>{{ metrics()?.executionTime || 0 }}ms</span>
          </div>
        </div>
      </div>

      <div class="container-info">
        <small>Container ID: {{ containerId() }}</small>
        <div *ngIf="loading()" class="loading-indicator">처리 중...</div>
      </div>
    </div>
  `,
  styles: [`
    .angular-component {
      border: 2px solid #DD0031;
      background: linear-gradient(135deg, #fff0f0 0%, #ffe0e0 100%);
    }

    .framework-badge.angular {
      background: #DD0031;
      color: white;
    }

    .count-value {
      color: #DD0031;
      text-shadow: 0 2px 4px rgba(221, 0, 49, 0.3);
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(221, 0, 49, 0.3);
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
  `]
})
export class AngularCounterComponent implements OnInit, OnDestroy {
  // Signals를 사용한 반응형 상태 관리
  containerState = signal<CounterState>({
    count: 0,
    lastUpdated: Date.now(),
    framework: 'none'
  });

  loading = signal(false);
  containerId = signal('');
  metrics = signal<any>(null);

  // 공유 매니저 인스턴스
  private sharedManager = SharedContainerManager.getInstance();
  private eventHandler?: (event: Event) => void;

  ngOnInit() {
    this.setupEventListener();
    this.initContainer();
  }

  ngOnDestroy() {
    if (this.eventHandler) {
      window.removeEventListener('gaesup:stateChange', this.eventHandler);
    }
  }

  private setupEventListener() {
    this.eventHandler = (event: Event) => {
      const customEvent = event as CustomEvent<SharedStateEvent>;
      const { type, containerId: eventContainerId, data } = customEvent.detail;
      
      if (type === 'stateChange' && eventContainerId === this.containerId()) {
        const newState = this.sharedManager.getContainerState(this.containerId());
        if (newState) {
          this.containerState.set(newState);
        }
        
        // 메트릭스 업데이트
        const newMetrics = this.sharedManager.getContainerMetrics(this.containerId());
        this.metrics.set(newMetrics);
      }
    };

    window.addEventListener('gaesup:stateChange', this.eventHandler);
  }

  private async initContainer() {
    try {
      this.loading.set(true);
      
      // 공유 컨테이너가 이미 있는지 확인
      const existingContainers = this.sharedManager.getAllContainers();
      let targetContainerId = '';
      
      if (existingContainers.length > 0) {
        // 기존 컨테이너 재사용
        targetContainerId = existingContainers[0].id;
      } else {
        // 새 컨테이너 생성
        targetContainerId = await this.sharedManager.createContainer({
          name: 'shared-counter',
          wasmUrl: '/wasm/counter.wasm',
          initialState: {
            count: 0,
            lastUpdated: Date.now(),
            framework: 'angular'
          },
          memoryLimit: 64 * 1024 * 1024, // 64MB
          enableMetrics: true
        });
      }
      
      this.containerId.set(targetContainerId);
      
      // 초기 상태 설정
      const initialState = this.sharedManager.getContainerState(targetContainerId);
      if (initialState) {
        this.containerState.set(initialState);
      }
      
      // 초기 메트릭스 설정
      const initialMetrics = this.sharedManager.getContainerMetrics(targetContainerId);
      this.metrics.set(initialMetrics);
      
    } catch (error) {
      console.error('Angular 컨테이너 초기화 실패:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async increment() {
    if (!this.containerId()) return;
    
    try {
      this.loading.set(true);
      await this.sharedManager.callContainerFunction(this.containerId(), 'increment', 'angular');
    } catch (error) {
      console.error('Increment 실패:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async decrement() {
    if (!this.containerId()) return;
    
    try {
      this.loading.set(true);
      await this.sharedManager.callContainerFunction(this.containerId(), 'decrement', 'angular');
    } catch (error) {
      console.error('Decrement 실패:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async reset() {
    if (!this.containerId()) return;
    
    try {
      this.loading.set(true);
      await this.sharedManager.callContainerFunction(this.containerId(), 'reset', 'angular');
    } catch (error) {
      console.error('Reset 실패:', error);
    } finally {
      this.loading.set(false);
    }
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  formatMemory(bytes: number): string {
    return (bytes / 1024).toFixed(1);
  }
} 