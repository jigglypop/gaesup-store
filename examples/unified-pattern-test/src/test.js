/**
 * 🚀 Gaesup-State 통합 패턴 간단 테스트
 * 브라우저 없이 Node.js에서 core 기능 테스트
 */

import { createGaesupManager, getGaesupMetrics } from '@gaesup-state/core'

// 테스트 상태
const initialState = {
  counter: 0,
  user: {
    name: 'Test User',
    email: 'test@example.com'
  },
  todos: [
    { id: 1, text: '첫 번째 할일', completed: false }
  ]
}

async function testUnifiedPattern() {
  console.log('🚀 통합 패턴 테스트 시작')
  
  try {
    // 1. Manager 생성
    console.log('\n1️⃣ Manager 생성')
    const manager = createGaesupManager(initialState)
    console.log('✅ Manager 생성 완료')
    
    // 2. 구독 테스트
    console.log('\n2️⃣ 구독 테스트')
    let updateCount = 0
    const unsubscribe = manager.subscribe((state) => {
      updateCount++
      console.log(`📡 상태 업데이트 ${updateCount}:`, {
        counter: state.data.counter,
        loading: state.loading,
        error: state.error,
        timestamp: state.timestamp
      })
    })
    
    // 3. 상태 업데이트 테스트
    console.log('\n3️⃣ 상태 업데이트 테스트')
    
    // 카운터 증가
    console.log('➕ 카운터 증가')
    await manager.actions.update('counter', 5)
    
    // 사용자 이름 변경
    console.log('👤 사용자 이름 변경')
    await manager.actions.update('user.name', 'Updated User')
    
    // TODO 추가
    console.log('📝 TODO 추가')
    const newTodo = { id: 2, text: '새로운 할일', completed: false }
    await manager.actions.update('todos', [...initialState.todos, newTodo])
    
    // 4. 배치 업데이트 테스트
    console.log('\n4️⃣ 배치 업데이트 테스트')
    const { batchUpdate } = await import('@gaesup-state/core')
    await batchUpdate([
      { path: 'counter', value: 10 },
      { path: 'user.email', value: 'batch@example.com' }
    ])
    
    // 5. 스냅샷 테스트
    console.log('\n5️⃣ 스냅샷 테스트')
    const snapshotId = manager.actions.snapshot()
    console.log('📸 스냅샷 생성:', snapshotId)
    
    // 상태 변경 후 복원
    await manager.actions.update('counter', 99)
    console.log('🔄 상태 변경 후 복원')
    await manager.actions.restore(snapshotId)
    
    // 6. 메트릭스 테스트
    console.log('\n6️⃣ 메트릭스 테스트')
    const metrics = getGaesupMetrics()
    console.log('📊 메트릭스:', metrics)
    
    // 7. 최종 상태 확인
    console.log('\n7️⃣ 최종 상태')
    console.log('🎯 최종 상태:', JSON.stringify(manager.state, null, 2))
    
    // 정리
    unsubscribe()
    manager.cleanup()
    
    console.log('\n✅ 모든 테스트 통과!')
    console.log(`📡 총 ${updateCount}번의 상태 업데이트 발생`)
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error)
    process.exit(1)
  }
}

// 테스트 실행
testUnifiedPattern().then(() => {
  console.log('\n🎉 통합 패턴 테스트 완료')
  process.exit(0)
}) 