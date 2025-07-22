import React, { useState, useEffect, useRef } from 'react';
import SharedContainerManager from '../../shared/SharedContainerManager';

const ReactCounter: React.FC = () => {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const managerRef = useRef<SharedContainerManager | null>(null);

  useEffect(() => {
    let mounted = true;

    const initializeContainer = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // SharedContainerManager 인스턴스 가져오기
        managerRef.current = SharedContainerManager.getInstance();
        
        // 초기화 (WASM 또는 TypeScript)
        await managerRef.current.initialize();
        
        // 시스템 정보 가져오기
        const info = managerRef.current.getSystemInfo();
        setSystemInfo(info);
        
        console.log('🔥 React: 시스템 정보', info);

        // 컨테이너 생성
        const id = await managerRef.current.createContainer({
          name: 'react-counter',
          initialState: { count: 0, framework: 'React' },
          memoryLimit: 1024 * 1024, // 1MB
          enableMetrics: true,
          enableSecurity: false
        });
        
        if (mounted) {
          setContainerId(id);
          
          // 초기 상태 로드
          const initialState = managerRef.current.getContainerState(id);
          if (initialState?.count !== undefined) {
            setCount(initialState.count);
          }
        }

      } catch (err) {
        console.error('❌ React: 컨테이너 초기화 실패:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeContainer();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!managerRef.current) return;

    // 상태 변경 이벤트 리스너
    const handleStateChange = (event: CustomEvent) => {
      const { containerId: eventContainerId, data } = event.detail;
      
      if (eventContainerId === containerId && data.state?.count !== undefined) {
        setCount(data.state.count);
        console.log('🔄 React: 상태 동기화', data);
      }
    };

    // 에러 이벤트 리스너
    const handleError = (event: CustomEvent) => {
      const { containerId: eventContainerId, data } = event.detail;
      
      if (eventContainerId === containerId) {
        setError(data.error);
        console.error('💥 React: 에러 발생', data);
      }
    };

    managerRef.current.addEventListener('shared-container-event', (event) => {
      switch (event.detail.type) {
        case 'stateChange':
          handleStateChange(event);
          break;
        case 'error':
          handleError(event);
          break;
      }
    });

    return () => {
      if (managerRef.current) {
        // 실제로는 이벤트 리스너 제거 로직이 필요하지만 간단히 생략
      }
    };
  }, [containerId]);

  const handleIncrement = async () => {
    if (!managerRef.current || !containerId) return;

    try {
      await managerRef.current.callContainerFunction(containerId, 'increment', 'React');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Function call failed');
    }
  };

  const handleDecrement = async () => {
    if (!managerRef.current || !containerId) return;

    try {
      await managerRef.current.callContainerFunction(containerId, 'decrement', 'React');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Function call failed');
    }
  };

  const handleReset = async () => {
    if (!managerRef.current || !containerId) return;

    try {
      await managerRef.current.callContainerFunction(containerId, 'reset', 'React');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Function call failed');
    }
  };

  const getMetrics = () => {
    if (!managerRef.current || !containerId) return null;
    return managerRef.current.getContainerMetrics(containerId);
  };

  if (isLoading) {
    return (
      <div className="framework-section react-section">
        <h3>⚛️ React Counter</h3>
        <div className="loading">
          🦀 {systemInfo?.isWasmEnabled ? 'Rust WASM' : 'TypeScript'} 모듈 로딩 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="framework-section react-section">
        <h3>⚛️ React Counter</h3>
        <div className="error">❌ {error}</div>
        <button onClick={() => window.location.reload()}>새로고침</button>
      </div>
    );
  }

  const metrics = getMetrics();

  return (
    <div className="framework-component react-component">
      <div className="framework-header">
        <h3>React Counter</h3>
      </div>

      <div className="counter-display">
        <div className="count-value">
          {count}
        </div>
        <div className="count-info">
          마지막 업데이트: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'N/A'}
        </div>
      </div>

      <div className="counter-controls">
        <button
          className="btn btn-primary"
          onClick={handleIncrement}
          disabled={isLoading}
        >
          +1
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleDecrement}
          disabled={isLoading}
        >
          -1
        </button>
        <button
          className="btn btn-danger"
          onClick={handleReset}
          disabled={isLoading}
        >
          Reset
        </button>
      </div>

      <div className="metrics-display">
        <h4>📊 컨테이너 메트릭스</h4>
        <div className="metrics-grid">
          <div className="metric">
            <span>메모리 사용량</span>
            <span>{metrics.memoryUsage?.used ? `${Math.round(metrics.memoryUsage.used / 1024)}KB` : '0KB'}</span>
          </div>
          <div className="metric">
            <span>함수 호출 수</span>
            <span>{metrics.functionCalls || 0}</span>
          </div>
          <div className="metric">
            <span>실행 시간</span>
            <span>{metrics.executionTime || 0}ms</span>
          </div>
          <div className="metric">
            <span>업타임</span>
            <span>{metrics.uptime ? `${Math.round(metrics.uptime / 1000)}s` : '0s'}</span>
          </div>
        </div>
      </div>

      <div className="container-info">
        <div>🦀 구현체: {systemInfo.isUsingWasm ? 'Rust WASM' : 'TypeScript'}</div>
        <div>📦 컨테이너 ID: {containerId || 'N/A'}</div>
        <div>🔧 초기화: {systemInfo.isInitialized ? '완료' : '진행 중'}</div>
        {isLoading && <div className="loading-indicator">처리 중...</div>}
        {error && <div style={{color: '#ff6b6b', marginTop: '5px'}}>❌ {error}</div>}
      </div>
    </div>
  );
};

export default ReactCounter; 