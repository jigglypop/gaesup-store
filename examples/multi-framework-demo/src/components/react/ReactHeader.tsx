import React, { useEffect } from 'react';
import { useGaesupState } from '@gaesup-state/react';
import { SHARED_STORE_ID, SharedState } from '../../stores/sharedStore';

export function ReactHeader() {
  // Gaesup-State 사용
  const [state, dispatch] = useGaesupState<SharedState>(SHARED_STORE_ID);
  
  // 메트릭스 상태
  const [metrics, setMetrics] = React.useState<any>(null);
  
  // 메트릭스 업데이트
  useEffect(() => {
    const updateMetrics = async () => {
      try {
        const m = await (window as any).GaesupCore.getMetrics(SHARED_STORE_ID);
        setMetrics(m);
      } catch (error) {
        console.error('Failed to get metrics:', error);
      }
    };
    
    updateMetrics();
    const interval = setInterval(updateMetrics, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <header className="react-header">
      <div className="header-content">
        <div className="header-title">
          <span className="framework-badge">⚛️ React</span>
          <h1>Multi-Framework State Demo</h1>
        </div>
        
        <div className="header-stats">
          <div className="stat-item">
            <span className="stat-label">Count</span>
            <span className="stat-value" id="header-count">{state.count}</span>
          </div>
          
          <div className="stat-item">
            <span className="stat-label">Total Calls</span>
            <span className="stat-value" id="header-calls">
              {metrics?.total_dispatches || 0}
            </span>
          </div>
          
          <div className="stat-item">
            <span className="stat-label">Memory</span>
            <span className="stat-value" id="header-memory">
              {Math.round((metrics?.memory_usage || 0) / 1024)}KB
            </span>
          </div>
          
          <div className="stat-item">
            <span className="stat-label">Last By</span>
            <span className="stat-value" id="header-framework">
              {state.framework}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

// DOM에 마운트하는 함수
export function mountReactHeader(elementId: string) {
  const element = document.getElementById(elementId);
  if (element) {
    const ReactDOM = require('react-dom/client');
    const root = ReactDOM.createRoot(element);
    root.render(<ReactHeader />);
    console.log('✅ React Header mounted');
  }
} 