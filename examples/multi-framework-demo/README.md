# 🚀 Gaesup-State Multi-Framework Demo

4개의 프레임워크(React, Vue, Svelte, Angular)가 **동시에 실행**되면서 **하나의 WASM 컨테이너 상태를 공유**하는 혁신적인 데모입니다.

## ✨ 무엇이 특별한가?

이 데모는 다음과 같은 세계 최초의 기능을 보여줍니다:

- 🔄 **실시간 상태 동기화**: 어떤 프레임워크에서 상태를 변경해도 모든 프레임워크가 즉시 동기화
- 🏗️ **진정한 컨테이너화**: Docker와 유사한 WASM 컨테이너 라이프사이클 관리
- ⚡ **네이티브 성능**: WASM의 네이티브 속도로 모든 프레임워크가 동작
- 🛡️ **격리된 실행**: 각 컨테이너는 독립적인 메모리 공간에서 실행
- 📊 **실시간 모니터링**: 메모리 사용량, 함수 호출, 실행 시간 등 실시간 메트릭스

## 🖼️ 데모 화면 구성

```
┌─────────────────────────────────────────────────────────────┐
│                    🚀 Gaesup-State Demo                     │
├─────────────┬─────────────┬─────────────┬─────────────────┤
│ ⚛️ React    │ 💚 Vue      │ 🔥 Svelte   │ 🅰️ Angular     │
│ Component   │ Component   │ Component   │ Component       │
│             │             │             │                 │
│   Count: 5  │   Count: 5  │   Count: 5  │   Count: 5      │
│   [-] [+]   │   [-] [+]   │   [-] [+]   │   [-] [+]       │
└─────────────┴─────────────┴─────────────┴─────────────────┘
│              📊 실시간 성능 메트릭스                        │
│  메모리: 2.3MB | 함수호출: 15 | 실행시간: 0.8ms             │
└─────────────────────────────────────────────────────────────┘
```

## 🏃‍♂️ 빠른 시작

### 1. 의존성 설치
```bash
# 프로젝트 루트에서
cd examples/multi-framework-demo
pnpm install
```

### 2. 개발 서버 실행
```bash
pnpm dev
```

### 3. 브라우저 접속
```
http://localhost:3000
```

### 4. 마법 경험하기! ✨
1. 아무 프레임워크의 버튼을 클릭
2. 모든 프레임워크가 동시에 업데이트되는 것을 확인
3. 실시간 성능 메트릭스 모니터링
4. 브라우저 개발자 도구 콘솔에서 로그 확인

## 🛠️ 사용 가능한 명령어

```bash
# 개발 서버 시작 (권장)
pnpm dev

# 프로덕션 빌드
pnpm build

# 빌드 미리보기
pnpm preview

# 타입 체크
pnpm typecheck

# 린팅
pnpm lint

# 정리
pnpm clean
```

## 🔧 기술적 구현

### 핵심 아키텍처
```
┌─────────────────────────────────────────────────────────┐
│                 SharedContainerManager                  │
│            (싱글톤 상태 관리 시스템)                    │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
    ┌─────▼─────┬─────▼─────┬─────▼─────┬─────────────┐
    │   React   │    Vue    │  Svelte   │   Angular   │
    │ Component │ Component │ Component │ Component   │
    └───────────┴───────────┴───────────┴─────────────┘
                      │
              ┌───────▼───────┐
              │ WASM Container │
              │   (Mock/Real)  │
              └───────────────┘
```

### 상태 동기화 메커니즘
1. **CustomEvent 기반**: 브라우저 네이티브 이벤트 시스템 활용
2. **EventTarget 추상화**: 프레임워크 독립적인 이벤트 처리
3. **Singleton 패턴**: 단일 WASM 컨테이너 인스턴스 공유
4. **실시간 브로드캐스팅**: 상태 변경 시 모든 프레임워크에 즉시 전파

### 프레임워크별 통합

#### React (Hooks)
```typescript
const { containerState, loading, call } = useContainerState('shared-counter');
```

#### Vue (Composition API)
```typescript
const { containerState, loading, call } = useContainerState('shared-counter');
```

#### Svelte (Stores)
```typescript
const { state, loading, call } = createContainerStore('shared-counter');
```

#### Angular (Signals)
```typescript
containerState = signal(initialState);
loading = signal(false);
```

## 🎭 Mock WASM 시스템

이 데모는 실제 WASM 모듈 없이도 동작할 수 있도록 완전한 Mock 시스템을 포함합니다:

- **WebAssembly.instantiate 모킹**: 실제 WASM 로드 시뮬레이션
- **Fetch 인터셉션**: .wasm 파일 요청 가로채기
- **메트릭스 시뮬레이션**: 실제와 같은 성능 데이터 생성
- **디버깅 도구**: 브라우저 콘솔에서 `logWASMState()` 호출 가능

## 🚀 프로덕션 배포

### 1. 빌드
```bash
pnpm build
```

### 2. 정적 서버 배포
생성된 `dist` 폴더를 정적 서버에 배포:
- Vercel, Netlify, GitHub Pages 등
- 중요: WASM 지원을 위해 적절한 HTTP 헤더 설정 필요

### 3. 필수 HTTP 헤더
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 🧪 실제 WASM 모듈 사용하기

Mock 대신 실제 WASM 모듈을 사용하려면:

1. **WASM 파일 추가**: `public/wasm/counter.wasm`
2. **컨테이너 설정 수정**: `wasmUrl` 경로 확인
3. **Mock 비활성화**: `src/polyfills/wasm-polyfill.ts` 수정

## 🔍 디버깅 팁

### 브라우저 콘솔에서:
```javascript
// WASM 상태 확인
logWASMState()

// Mock 인스턴스 접근
getMockWASMInstance()

// 공유 매니저 접근
window.GaesupSharedManager
```

### 개발자 도구 Network 탭:
- WASM 파일 로드 확인
- Mock 응답 확인

### 성능 프로파일링:
- React DevTools
- Vue DevTools  
- Angular DevTools
- Svelte DevTools

## 🤝 기여하기

1. 프레임워크별 추가 기능 구현
2. 실제 WASM 모듈 예제 추가
3. 성능 최적화
4. 추가 컨테이너 타입 지원

## 📞 지원

문제가 있거나 질문이 있으시면:
- GitHub Issues 생성
- 개발자 도구 콘솔 로그 확인
- Mock WASM 상태 디버깅

---

**이 데모는 Gaesup-State 프로젝트의 혁신적인 기능을 보여주는 살아있는 증명입니다!** 🎉 