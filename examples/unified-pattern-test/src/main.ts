/**
 * 🚀 Gaesup-State 통합 패턴 테스트
 * React, Vue, Svelte에서 동일한 API 사용 데모
 */

import { mountReactDemo } from './components/ReactDemo'
import { mountVueDemo } from './components/VueDemo' 
import { mountSvelteDemo } from './components/SvelteDemo'
import { mountSharedDemo } from './components/SharedDemo'

// 공통 초기 상태
export interface AppState {
  counter: number
  user: {
    name: string
    email: string
  }
  todos: Array<{
    id: number
    text: string
    completed: boolean
  }>
}

export const initialState: AppState = {
  counter: 0,
  user: {
    name: 'Gaesup User',
    email: 'user@gaesup.com'
  },
  todos: [
    { id: 1, text: 'React에서 테스트', completed: false },
    { id: 2, text: 'Vue에서 테스트', completed: false },
    { id: 3, text: 'Svelte에서 테스트', completed: false }
  ]
}

async function main() {
  console.log('🚀 통합 패턴 테스트 시작')
  
  try {
    // 각 프레임워크별 컴포넌트 마운트
    await Promise.all([
      mountReactDemo('react-root', initialState),
      mountVueDemo('vue-root', initialState),  
      mountSvelteDemo('svelte-root', initialState),
      mountSharedDemo('shared-root', initialState)
    ])
    
    console.log('✅ 모든 프레임워크 데모 로드 완료')
  } catch (error) {
    console.error('❌ 데모 로드 실패:', error)
  }
}

main() 