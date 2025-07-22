import './polyfills/wasm-polyfill';
import { 
  initializeSharedStore, 
  subscribeToStore, 
  connectDevTools,
  SHARED_STORE_ID 
} from './stores/sharedStore';

// 프레임워크별 컴포넌트 마운트 함수들
import { mountReactHeader } from './components/react/ReactHeader';
import { mountSvelteMain } from './components/svelte/mountSvelte';
import { mountVueFooter } from './components/vue/mountVue';
import { mountAngularSidebar } from './components/angular/mountAngular';

// GaesupCore를 전역에 노출 (컴포넌트에서 사용하기 위해)
import { GaesupCore } from '@gaesup-state/core';
(window as any).GaesupCore = GaesupCore;

class MultiFrameworkApp {
  private unsubscribe: (() => void) | null = null;

  async init() {
    try {
      console.log('🚀 Gaesup Multi-Framework Demo 초기화 시작...');
      
      // 1. 공유 스토어 초기화
      await initializeSharedStore();
      console.log('✅ Shared store initialized');
      
      // 2. Redux DevTools 연결
      connectDevTools();
      
      // 3. 각 프레임워크 컴포넌트 마운트
      this.mountAllComponents();
      
      // 4. 상태 변경 구독
      this.unsubscribe = subscribeToStore((state) => {
        console.log('📊 State updated:', state);
      });
      
      // 5. 로딩 오버레이 제거
      this.hideLoadingOverlay();
      
      console.log('✅ Gaesup Multi-Framework Demo 초기화 완료!');
      
    } catch (error) {
      console.error('❌ 앱 초기화 실패:', error);
      this.showError(error);
    }
  }

  private mountAllComponents() {
    console.log('🔧 프레임워크 컴포넌트 마운트 시작...');
    
    // React 헤더
    try {
      mountReactHeader('react-header');
      console.log('✅ React header mounted');
    } catch (error) {
      console.error('❌ React header mount failed:', error);
    }
    
    // Angular 사이드바
    try {
      mountAngularSidebar('angular-sidebar');
      console.log('✅ Angular sidebar mounted');
    } catch (error) {
      console.error('❌ Angular sidebar mount failed:', error);
    }
    
    // Svelte 메인
    try {
      mountSvelteMain('svelte-main');
      console.log('✅ Svelte main mounted');
    } catch (error) {
      console.error('❌ Svelte main mount failed:', error);
    }
    
    // Vue 푸터
    try {
      mountVueFooter('vue-footer');
      console.log('✅ Vue footer mounted');
    } catch (error) {
      console.error('❌ Vue footer mount failed:', error);
    }
  }

  private hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  private showError(error: any) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.innerHTML = `
        <div style="text-align: center;">
          <h2 style="color: #ef4444; margin-bottom: 1rem;">❌ 초기화 실패</h2>
          <p style="margin-bottom: 1rem;">${error.message || error}</p>
          <button onclick="location.reload()" style="
            padding: 0.75rem 1.5rem; 
            background: #3b82f6; 
            color: white; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer;
            font-size: 1rem;
          ">
            🔄 다시 시도
          </button>
        </div>
      `;
    }
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    
    // 스토어 정리
    GaesupCore.cleanupStore(SHARED_STORE_ID).catch(console.error);
    
    console.log('🧹 Multi-Framework App 정리 완료');
  }
}

// 앱 초기화
let app: MultiFrameworkApp;

document.addEventListener('DOMContentLoaded', async () => {
  app = new MultiFrameworkApp();
  await app.init();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (app) {
    app.destroy();
  }
});

// 에러 핸들링
window.addEventListener('error', (event) => {
  console.error('글로벌 에러:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('처리되지 않은 Promise 거부:', event.reason);
});

export { MultiFrameworkApp }; 