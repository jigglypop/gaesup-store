import React from 'react';
import { createRoot } from 'react-dom/client';
import { useGaesupState } from '@gaesup-state/react';
import {
  SHARED_STORE_ID,
  type SharedState,
  decrementCount,
  incrementCount,
  resetCount
} from '../../stores/sharedStore';

export function ReactHeader() {
  const [state] = useGaesupState<SharedState>(SHARED_STORE_ID);

  return (
    <article className="counter-card" style={{ '--accent': '#61dafb' } as React.CSSProperties}>
      <div>
        <div className="framework-name">React</div>
        <div className="card-title">Hook 구독자</div>
        <p className="card-copy">React adapter hook으로 공유 store snapshot을 렌더링합니다.</p>
      </div>

      <div>
        <div className="count-value" data-counter="react">{state.count}</div>
        <div className="last-update">마지막 작성자: {state.framework}</div>
        <div className="button-row">
          <button className="primary" data-action="react-inc" onClick={() => incrementCount('React')}>+1</button>
          <button data-action="react-dec" onClick={() => decrementCount('React')}>-1</button>
          <button data-action="react-reset" onClick={() => resetCount('React')}>Reset</button>
        </div>
      </div>
    </article>
  );
}

export function mountReactHeader(elementId: string) {
  const element = document.getElementById(elementId);
  if (element) {
    createRoot(element).render(<ReactHeader />);
  }
}
