# 5. Design Tokens 통합 시스템 구현 계획

## 5.1 개요

Design Tokens 시스템은 아파트 단지의 "조경 가이드라인" 역할로, 모든 Building/Unit이 일관된 디자인 언어를 사용하도록 보장합니다.

### 핵심 목표
- **스타일 통일성**: 모든 프레임워크에서 동일한 디자인 토큰 사용
- **테마 지원**: 라이트/다크 모드 및 브랜드별 테마 전환
- **실시간 동기화**: 토큰 변경 시 모든 모듈 즉시 반영
- **성능 최적화**: CSS Custom Properties 활용한 효율적 업데이트

## 5.2 토큰 구조 설계

### 5.2.1 계층적 토큰 구조

```typescript
interface DesignTokens {
  meta: TokenMetadata
  global: GlobalTokens
  semantic: SemanticTokens
  component: ComponentTokens
  theme: ThemeVariants
}

interface GlobalTokens {
  // 기본 색상 팔레트
  colors: {
    primary: ColorScale
    secondary: ColorScale
    neutral: ColorScale
    semantic: SemanticColors
  }
  
  // 타이포그래피
  typography: {
    fontFamily: FontFamilies
    fontSize: FontSizes
    fontWeight: FontWeights
    lineHeight: LineHeights
    letterSpacing: LetterSpacings
  }
  
  // 간격 시스템
  spacing: SpacingScale
  
  // 사이즈 시스템
  sizing: SizingScale
  
  // 그림자 및 효과
  shadows: ShadowScale
  borders: BorderTokens
  radii: RadiusScale
}

interface SemanticTokens {
  // 의미적 색상
  colors: {
    text: {
      primary: string
      secondary: string
      disabled: string
      inverse: string
    }
    background: {
      primary: string
      secondary: string
      overlay: string
      surface: string
    }
    border: {
      default: string
      subtle: string
      strong: string
    }
    feedback: {
      success: string
      warning: string
      error: string
      info: string
    }
  }
  
  // 의미적 간격
  spacing: {
    component: Record<string, string>
    layout: Record<string, string>
  }
}
```

### 5.2.2 테마 변형

```typescript
interface ThemeVariant {
  id: string
  name: string
  description: string
  tokens: Partial<GlobalTokens>
  semanticOverrides: Partial<SemanticTokens>
  media?: MediaQuery
}

interface ThemeVariants {
  light: ThemeVariant
  dark: ThemeVariant
  [brandId: string]: ThemeVariant    // 브랜드별 테마
}

const darkTheme: ThemeVariant = {
  id: 'dark',
  name: '다크 테마',
  description: '어두운 배경의 테마',
  tokens: {
    colors: {
      primary: {
        50: '#e3f2fd',
        100: '#bbdefb',
        // ... 다크 테마용 색상 스케일
        900: '#0d47a1'
      }
    }
  },
  semanticOverrides: {
    colors: {
      text: {
        primary: '#ffffff',
        secondary: '#b3b3b3'
      },
      background: {
        primary: '#121212',
        secondary: '#1e1e1e'
      }
    }
  },
  media: '(prefers-color-scheme: dark)'
}
```

## 5.3 토큰 관리 시스템

### 5.3.1 Token Manager

```typescript
class DesignTokenManager {
  private tokens: DesignTokens
  private activeTheme: string = 'light'
  private subscribers: Set<TokenSubscriber> = new Set()
  private cssProperties: Map<string, string> = new Map()
  
  constructor(private tokenStorage: TokenStorage) {}
  
  async initialize(): Promise<void> {
    // 토큰 로드
    this.tokens = await this.tokenStorage.loadTokens()
    
    // CSS 커스텀 프로퍼티 주입
    this.injectCSSProperties()
    
    // 시스템 테마 감지
    this.detectSystemTheme()
    
    // 미디어 쿼리 리스너 설정
    this.setupMediaQueryListeners()
  }
  
  // 테마 변경
  setTheme(themeId: string, options: SetThemeOptions = {}): void {
    const theme = this.tokens.theme[themeId]
    if (!theme) {
      throw new ThemeNotFoundError(themeId)
    }
    
    this.activeTheme = themeId
    
    // CSS 변수 업데이트
    this.updateCSSProperties(theme)
    
    // 저장소에 기본 설정 저장
    if (options.persist) {
      this.tokenStorage.saveThemePreference(themeId)
    }
    
    // 구독자들에게 알림
    this.notifySubscribers('theme_changed', { themeId, theme })
  }
  
  // 토큰 값 조회
  getToken(path: string): string | undefined {
    return this.resolveTokenPath(path, this.activeTheme)
  }
  
  // 런타임 토큰 업데이트
  updateTokens(updates: Partial<DesignTokens>): void {
    this.tokens = this.mergeTokens(this.tokens, updates)
    this.injectCSSProperties()
    this.notifySubscribers('tokens_updated', { updates })
  }
  
  private injectCSSProperties(): void {
    const cssVars = this.generateCSSVariables()
    const styleElement = this.getOrCreateStyleElement()
    
    styleElement.textContent = `
      :root {
        ${Array.from(cssVars.entries())
          .map(([key, value]) => `${key}: ${value};`)
          .join('\n        ')}
      }
    `
  }
  
  private generateCSSVariables(): Map<string, string> {
    const vars = new Map<string, string>()
    
    // 글로벌 토큰 변환
    this.flattenTokens('', this.tokens.global, vars)
    
    // 시맨틱 토큰 변환
    this.flattenTokens('semantic', this.tokens.semantic, vars)
    
    // 현재 테마 오버라이드 적용
    const currentTheme = this.tokens.theme[this.activeTheme]
    if (currentTheme.tokens) {
      this.flattenTokens('', currentTheme.tokens, vars)
    }
    if (currentTheme.semanticOverrides) {
      this.flattenTokens('semantic', currentTheme.semanticOverrides, vars)
    }
    
    return vars
  }
  
  private flattenTokens(
    prefix: string,
    tokens: any,
    result: Map<string, string>
  ): void {
    for (const [key, value] of Object.entries(tokens)) {
      const cssVar = `--${prefix ? prefix + '-' : ''}${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
      
      if (typeof value === 'string' || typeof value === 'number') {
        result.set(cssVar, String(value))
      } else if (typeof value === 'object' && value !== null) {
        this.flattenTokens(
          prefix ? `${prefix}-${key}` : key,
          value,
          result
        )
      }
    }
  }
}
```

### 5.3.2 토큰 동기화

```typescript
class TokenSynchronizer {
  private syncChannel: BroadcastChannel
  private lastSyncVersion: string = ''
  
  constructor(private tokenManager: DesignTokenManager) {
    this.syncChannel = new BroadcastChannel('design-tokens-sync')
    this.setupSyncListeners()
  }
  
  private setupSyncListeners(): void {
    // 다른 탭/프레임과 동기화
    this.syncChannel.addEventListener('message', (event) => {
      const { type, data, version } = event.data
      
      if (version !== this.lastSyncVersion) {
        switch (type) {
          case 'theme_changed':
            this.tokenManager.setTheme(data.themeId, { persist: false })
            break
            
          case 'tokens_updated':
            this.tokenManager.updateTokens(data.updates)
            break
            
          case 'custom_properties_changed':
            this.updateCustomProperties(data.properties)
            break
        }
        
        this.lastSyncVersion = version
      }
    })
    
    // 토큰 변경 사항 브로드캐스트
    this.tokenManager.subscribe((event, data) => {
      this.broadcastChange(event, data)
    })
  }
  
  private broadcastChange(type: string, data: any): void {
    const message = {
      type,
      data,
      version: this.generateSyncVersion(),
      timestamp: Date.now()
    }
    
    this.syncChannel.postMessage(message)
    this.lastSyncVersion = message.version
  }
}
```

## 5.4 프레임워크 통합

### 5.4.1 React 통합

```typescript
// React Hooks
export function useDesignTokens() {
  const [tokens, setTokens] = useState<DesignTokens>()
  const [theme, setTheme] = useState<string>('light')
  
  useEffect(() => {
    const manager = getTokenManager()
    
    setTokens(manager.getTokens())
    setTheme(manager.getActiveTheme())
    
    return manager.subscribe((event, data) => {
      if (event === 'theme_changed') {
        setTheme(data.themeId)
      } else if (event === 'tokens_updated') {
        setTokens(manager.getTokens())
      }
    })
  }, [])
  
  return {
    tokens,
    theme,
    setTheme: (themeId: string) => getTokenManager().setTheme(themeId, { persist: true }),
    getToken: (path: string) => getTokenManager().getToken(path)
  }
}

// Styled Components 통합
export const styled = {
  div: (template: TemplateStringsArray, ...expressions: any[]) => {
    return styled.div`
      ${template.map((str, i) => {
        const expr = expressions[i]
        if (typeof expr === 'function') {
          return str + expr(getTokenManager())
        }
        return str + (expr || '')
      }).join('')}
    `
  }
}

// 사용 예시
const StyledButton = styled.div`
  background-color: var(--colors-primary-500);
  color: var(--semantic-colors-text-inverse);
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--radii-md);
  font-size: var(--typography-font-size-sm);
  
  &:hover {
    background-color: var(--colors-primary-600);
  }
`
```

### 5.4.2 Vue/Svelte 통합

```typescript
// Vue Composable
export function useDesignTokens() {
  const tokens = ref<DesignTokens>()
  const theme = ref<string>('light')
  
  onMounted(() => {
    const manager = getTokenManager()
    tokens.value = manager.getTokens()
    theme.value = manager.getActiveTheme()
    
    const unsubscribe = manager.subscribe((event, data) => {
      if (event === 'theme_changed') {
        theme.value = data.themeId
      } else if (event === 'tokens_updated') {
        tokens.value = manager.getTokens()
      }
    })
    
    onUnmounted(unsubscribe)
  })
  
  return {
    tokens: readonly(tokens),
    theme: readonly(theme),
    setTheme: (themeId: string) => getTokenManager().setTheme(themeId, { persist: true })
  }
}

// Svelte Store
export const designTokens = derived(
  [tokenStore, themeStore],
  ([$tokens, $theme]) => ({
    tokens: $tokens,
    theme: $theme,
    getToken: (path: string) => getTokenManager().getToken(path)
  })
)
```

## 5.5 성능 최적화

### 5.5.1 지연 로딩 및 캐싱

```typescript
class TokenLoader {
  private tokenCache: Map<string, DesignTokens> = new Map()
  private loadingPromises: Map<string, Promise<DesignTokens>> = new Map()
  
  async loadTokens(version?: string): Promise<DesignTokens> {
    const cacheKey = version || 'latest'
    
    // 캐시 확인
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)!
    }
    
    // 중복 로딩 방지
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!
    }
    
    // 토큰 로딩
    const loadPromise = this.fetchTokens(version)
    this.loadingPromises.set(cacheKey, loadPromise)
    
    try {
      const tokens = await loadPromise
      this.tokenCache.set(cacheKey, tokens)
      return tokens
    } finally {
      this.loadingPromises.delete(cacheKey)
    }
  }
  
  // 점진적 토큰 로딩
  async loadTokensProgressively(): Promise<DesignTokens> {
    // 1. 핵심 토큰 먼저 로딩 (색상, 타이포그래피)
    const coreTokens = await this.loadCoreTokens()
    
    // 2. 추가 토큰 병렬 로딩 (그림자, 애니메이션 등)
    const [semanticTokens, componentTokens, themeTokens] = await Promise.all([
      this.loadSemanticTokens(),
      this.loadComponentTokens(),
      this.loadThemeTokens()
    ])
    
    return {
      ...coreTokens,
      semantic: semanticTokens,
      component: componentTokens,
      theme: themeTokens
    }
  }
}
```

### 5.5.2 CSS 최적화

```typescript
class CSSOptimizer {
  optimizeCSSProperties(tokens: DesignTokens): string {
    const usedProperties = this.analyzeUsedProperties()
    const optimizedVars = this.generateOptimizedVariables(tokens, usedProperties)
    
    return `
      :root {
        ${optimizedVars.join('\n        ')}
      }
      
      ${this.generateUtilityClasses(tokens)}
      ${this.generateComponentClasses(tokens)}
    `
  }
  
  private generateUtilityClasses(tokens: DesignTokens): string {
    const utilities: string[] = []
    
    // 간격 유틸리티
    Object.entries(tokens.global.spacing).forEach(([key, value]) => {
      utilities.push(`.p-${key} { padding: var(--spacing-${key}); }`)
      utilities.push(`.m-${key} { margin: var(--spacing-${key}); }`)
    })
    
    // 색상 유틸리티
    Object.entries(tokens.global.colors.primary).forEach(([shade, _]) => {
      utilities.push(`.text-primary-${shade} { color: var(--colors-primary-${shade}); }`)
      utilities.push(`.bg-primary-${shade} { background-color: var(--colors-primary-${shade}); }`)
    })
    
    return utilities.join('\n')
  }
}
```

## 5.6 개발자 도구

### 5.6.1 토큰 브라우저

```typescript
class TokenBrowser {
  renderTokenBrowser(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'token-browser'
    
    const tokens = getTokenManager().getTokens()
    
    container.innerHTML = `
      <div class="token-browser__header">
        <h3>Design Tokens</h3>
        <select class="theme-selector">
          ${Object.keys(tokens.theme).map(themeId => 
            `<option value="${themeId}">${tokens.theme[themeId].name}</option>`
          ).join('')}
        </select>
      </div>
      
      <div class="token-browser__content">
        ${this.renderTokenGroups(tokens)}
      </div>
    `
    
    // 테마 변경 이벤트
    container.querySelector('.theme-selector')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement
      getTokenManager().setTheme(target.value)
    })
    
    return container
  }
  
  private renderTokenGroups(tokens: DesignTokens): string {
    return `
      ${this.renderColorTokens(tokens.global.colors)}
      ${this.renderTypographyTokens(tokens.global.typography)}
      ${this.renderSpacingTokens(tokens.global.spacing)}
    `
  }
}
```

---

이 Design Tokens 시스템을 통해 **모든 프레임워크와 모듈에서 일관된** 디자인 언어를 유지할 수 있으며, 브랜드 변경이나 테마 전환도 **실시간으로 반영**됩니다. 