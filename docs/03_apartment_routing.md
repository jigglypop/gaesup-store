# 3. Apartment 라우팅 시스템 구현 계획

## 3.1 개요

Apartment 라우팅 시스템은 "아파트 동/호수" 메타포를 사용하여 마이크로 프론트엔드 모듈을 체계적으로 관리하고 네비게이션하는 시스템입니다.

### 핵심 개념
- **Apartment**: 전체 애플리케이션 (예: gaesup-main)
- **Building (동)**: 기능별 영역 (예: header, dashboard, footer)
- **Unit (호수)**: 특정 구현 버전 (예: react-v1, vue-v2)
- **Container**: Unit 내부의 실제 컴포넌트

### 주소 체계 예시
```
/apartment/gaesup-main/building/header/unit/react-v1-2-0
/apartment/gaesup-main/building/dashboard/unit/vue-v2-0-0
/apartment/gaesup-admin/building/sidebar/unit/svelte-v1-5-0
```

## 3.2 라우팅 아키텍처

### 3.2.1 라우팅 엔진 구조

```typescript
interface RoutingEngine {
  // 라우트 매칭
  match(url: string): RouteMatch | null
  
  // 네비게이션
  navigate(path: string, options?: NavigationOptions): Promise<void>
  navigateToUnit(buildingId: string, unitId: string, params?: RouteParams): Promise<void>
  
  // 라우트 등록
  registerRoute(route: RouteDefinition): void
  registerDynamicRoute(pattern: string, handler: RouteHandler): void
  
  // 가드 및 훅
  beforeEach(guard: NavigationGuard): () => void
  afterEach(hook: NavigationHook): () => void
  
  // 상태 관리
  getCurrentRoute(): Route
  getHistory(): RouteHistory
}

interface RouteMatch {
  route: Route
  params: RouteParams
  query: QueryParams
  building: BuildingInfo
  unit: UnitInfo
  guards: NavigationGuard[]
}
```

### 3.2.2 URL 패턴 매칭

```typescript
class URLPatternMatcher {
  private patterns: Map<string, CompiledPattern> = new Map()
  
  compile(pattern: string): CompiledPattern {
    // URL 패턴을 정규식으로 컴파일
    // 예: /apartment/:apartmentId/building/:buildingId/unit/:unitId
    
    const paramNames: string[] = []
    const regexPattern = pattern
      .replace(/:[a-zA-Z]+/g, (match) => {
        paramNames.push(match.slice(1))
        return '([^/]+)'
      })
      .replace(/\*/g, '(.*)')
    
    return {
      regex: new RegExp(`^${regexPattern}$`),
      paramNames,
      pattern
    }
  }
  
  match(url: string, pattern: CompiledPattern): RouteMatch | null {
    const matches = url.match(pattern.regex)
    if (!matches) return null
    
    const params: RouteParams = {}
    pattern.paramNames.forEach((name, index) => {
      params[name] = matches[index + 1]
    })
    
    return { params, pattern }
  }
}
```

## 3.3 동적 라우팅 전략

### 3.3.1 Unit 선택 전략

```typescript
interface UnitSelectionStrategy {
  type: 'active' | 'canary' | 'ab_test' | 'feature_flag' | 'user_preference'
  select(building: Building, context: SelectionContext): Unit
}

class UnitSelector {
  private strategies: Map<string, UnitSelectionStrategy> = new Map()
  
  constructor() {
    this.registerDefaultStrategies()
  }
  
  async selectUnit(
    building: Building,
    strategy: string = 'active'
  ): Promise<Unit> {
    const selector = this.strategies.get(strategy)
    if (!selector) {
      throw new Error(`Unknown strategy: ${strategy}`)
    }
    
    const context = await this.buildSelectionContext()
    return selector.select(building, context)
  }
  
  private registerDefaultStrategies() {
    // Active Unit 전략 (기본)
    this.strategies.set('active', {
      type: 'active',
      select: (building) => building.units[building.activeUnit]
    })
    
    // Canary 배포 전략
    this.strategies.set('canary', {
      type: 'canary',
      select: (building, context) => {
        const canaryUnit = building.units[building.canaryUnit]
        const canaryPercentage = canaryUnit?.rollout?.percentage || 0
        
        const userHash = this.hashUser(context.userId)
        const threshold = Math.floor(canaryPercentage * 100)
        
        return userHash % 10000 < threshold
          ? canaryUnit
          : building.units[building.activeUnit]
      }
    })
    
    // A/B 테스트 전략
    this.strategies.set('ab_test', {
      type: 'ab_test',
      select: (building, context) => {
        const experiment = context.experiments?.find(
          exp => exp.buildingId === building.id
        )
        
        if (!experiment) {
          return building.units[building.activeUnit]
        }
        
        const variant = this.getExperimentVariant(experiment, context.userId)
        return building.units[variant.unitId]
      }
    })
    
    // Feature Flag 전략
    this.strategies.set('feature_flag', {
      type: 'feature_flag',
      select: (building, context) => {
        const flags = context.featureFlags || {}
        const flagKey = `unit_${building.id}`
        
        if (flags[flagKey]) {
          const unitId = flags[flagKey]
          return building.units[unitId] || building.units[building.activeUnit]
        }
        
        return building.units[building.activeUnit]
      }
    })
  }
}
```

### 3.3.2 라우트 가드 시스템

```typescript
interface NavigationGuard {
  name: string
  priority: number
  guard(to: Route, from: Route, next: NavigationNext): void | Promise<void>
}

class GuardChain {
  private guards: NavigationGuard[] = []
  
  add(guard: NavigationGuard): void {
    this.guards.push(guard)
    this.guards.sort((a, b) => b.priority - a.priority)
  }
  
  async execute(to: Route, from: Route): Promise<boolean> {
    for (const guard of this.guards) {
      let proceedToNext = false
      let redirectTo: string | null = null
      
      const next: NavigationNext = (arg?: string | boolean) => {
        if (typeof arg === 'string') {
          redirectTo = arg
        } else {
          proceedToNext = arg !== false
        }
      }
      
      await guard.guard(to, from, next)
      
      if (redirectTo) {
        await this.router.navigate(redirectTo)
        return false
      }
      
      if (!proceedToNext) {
        return false
      }
    }
    
    return true
  }
}

// 가드 예시
const authGuard: NavigationGuard = {
  name: 'auth',
  priority: 100,
  async guard(to, from, next) {
    const isAuthenticated = await authService.isAuthenticated()
    
    if (to.meta?.requiresAuth && !isAuthenticated) {
      next('/login')
    } else {
      next()
    }
  }
}

const permissionGuard: NavigationGuard = {
  name: 'permission',
  priority: 90,
  async guard(to, from, next) {
    const requiredPermissions = to.meta?.permissions || []
    const hasPermissions = await permissionService.check(requiredPermissions)
    
    if (!hasPermissions) {
      next('/forbidden')
    } else {
      next()
    }
  }
}
```

## 3.4 네비게이션 매니저

### 3.4.1 History 관리

```typescript
interface HistoryManager {
  push(route: Route, state?: any): void
  replace(route: Route, state?: any): void
  go(delta: number): void
  back(): void
  forward(): void
  
  getCurrentIndex(): number
  getHistory(): Route[]
  canGoBack(): boolean
  canGoForward(): boolean
  
  onPopState(handler: PopStateHandler): () => void
}

class BrowserHistoryManager implements HistoryManager {
  private history: Route[] = []
  private currentIndex: number = -1
  private popStateHandlers: Set<PopStateHandler> = new Set()
  
  constructor() {
    this.setupPopStateListener()
    this.initializeFromBrowser()
  }
  
  push(route: Route, state?: any): void {
    // 현재 위치 이후의 히스토리 제거
    this.history = this.history.slice(0, this.currentIndex + 1)
    
    // 새 항목 추가
    this.history.push(route)
    this.currentIndex++
    
    // 브라우저 히스토리 업데이트
    const url = this.buildURL(route)
    window.history.pushState(
      { ...state, route },
      route.title || '',
      url
    )
    
    // 메트릭 기록
    this.recordNavigation(route, 'push')
  }
  
  private buildURL(route: Route): string {
    const { apartment, building, unit, params, query } = route
    
    let url = `/apartment/${apartment}/building/${building}/unit/${unit}`
    
    // 경로 파라미터 치환
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url = url.replace(`:${key}`, value)
      })
    }
    
    // 쿼리 파라미터 추가
    if (query && Object.keys(query).length > 0) {
      const queryString = new URLSearchParams(query).toString()
      url += `?${queryString}`
    }
    
    return url
  }
}
```

### 3.4.2 트랜지션 관리

```typescript
interface TransitionManager {
  beforeTransition(from: Route, to: Route): Promise<void>
  duringTransition(progress: number): void
  afterTransition(from: Route, to: Route): void
  
  registerTransition(name: string, transition: Transition): void
  setDefaultTransition(name: string): void
}

interface Transition {
  name: string
  duration: number
  easing: string
  
  enter(element: HTMLElement): Promise<void>
  leave(element: HTMLElement): Promise<void>
  progress?(element: HTMLElement, progress: number): void
}

class TransitionManagerImpl implements TransitionManager {
  private transitions: Map<string, Transition> = new Map()
  private activeTransition: Transition | null = null
  private defaultTransitionName: string = 'fade'
  
  constructor() {
    this.registerBuiltInTransitions()
  }
  
  async beforeTransition(from: Route, to: Route): Promise<void> {
    const transitionName = this.selectTransition(from, to)
    this.activeTransition = this.transitions.get(transitionName) || null
    
    if (this.activeTransition) {
      // 이전 Unit의 leave 애니메이션
      const fromElement = this.getUnitElement(from)
      if (fromElement) {
        await this.activeTransition.leave(fromElement)
      }
    }
  }
  
  async afterTransition(from: Route, to: Route): Promise<void> {
    if (this.activeTransition) {
      // 새 Unit의 enter 애니메이션
      const toElement = this.getUnitElement(to)
      if (toElement) {
        await this.activeTransition.enter(toElement)
      }
    }
    
    this.activeTransition = null
  }
  
  private registerBuiltInTransitions() {
    // Fade 트랜지션
    this.registerTransition('fade', {
      name: 'fade',
      duration: 300,
      easing: 'ease-in-out',
      
      async leave(element: HTMLElement) {
        await animate(element, [
          { opacity: 1 },
          { opacity: 0 }
        ], {
          duration: 150,
          easing: 'ease-out'
        }).finished
      },
      
      async enter(element: HTMLElement) {
        await animate(element, [
          { opacity: 0 },
          { opacity: 1 }
        ], {
          duration: 150,
          easing: 'ease-in'
        }).finished
      }
    })
    
    // Slide 트랜지션
    this.registerTransition('slide', {
      name: 'slide',
      duration: 400,
      easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
      
      async leave(element: HTMLElement) {
        await animate(element, [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: 'translateX(-100%)', opacity: 0 }
        ], {
          duration: 200,
          easing: this.easing
        }).finished
      },
      
      async enter(element: HTMLElement) {
        await animate(element, [
          { transform: 'translateX(100%)', opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 }
        ], {
          duration: 200,
          easing: this.easing
        }).finished
      }
    })
  }
}
```

## 3.5 딥 링킹 및 상태 복원

### 3.5.1 URL 파서

```typescript
interface URLParser {
  parse(url: string): ParsedURL
  stringify(parsed: ParsedURL): string
  
  extractApartment(url: string): string | null
  extractBuilding(url: string): string | null
  extractUnit(url: string): string | null
}

interface ParsedURL {
  apartment?: string
  building?: string
  unit?: string
  params: RouteParams
  query: QueryParams
  hash?: string
}

class ApartmentURLParser implements URLParser {
  private patterns = {
    full: /^\/apartment\/([^\/]+)\/building\/([^\/]+)\/unit\/([^\/]+)/,
    apartment: /^\/apartment\/([^\/]+)/,
    building: /\/building\/([^\/]+)/,
    unit: /\/unit\/([^\/]+)/
  }
  
  parse(url: string): ParsedURL {
    const [pathname, search, hash] = this.splitURL(url)
    const parsed: ParsedURL = {
      params: {},
      query: this.parseQuery(search),
      hash
    }
    
    // Full pattern match
    const fullMatch = pathname.match(this.patterns.full)
    if (fullMatch) {
      parsed.apartment = fullMatch[1]
      parsed.building = fullMatch[2]
      parsed.unit = fullMatch[3]
      return parsed
    }
    
    // Individual pattern matches
    const apartmentMatch = pathname.match(this.patterns.apartment)
    if (apartmentMatch) {
      parsed.apartment = apartmentMatch[1]
    }
    
    const buildingMatch = pathname.match(this.patterns.building)
    if (buildingMatch) {
      parsed.building = buildingMatch[1]
    }
    
    const unitMatch = pathname.match(this.patterns.unit)
    if (unitMatch) {
      parsed.unit = unitMatch[1]
    }
    
    return parsed
  }
  
  stringify(parsed: ParsedURL): string {
    const parts: string[] = []
    
    if (parsed.apartment) {
      parts.push(`/apartment/${parsed.apartment}`)
    }
    
    if (parsed.building) {
      parts.push(`/building/${parsed.building}`)
    }
    
    if (parsed.unit) {
      parts.push(`/unit/${parsed.unit}`)
    }
    
    let url = parts.join('') || '/'
    
    // Add query parameters
    if (parsed.query && Object.keys(parsed.query).length > 0) {
      const queryString = new URLSearchParams(parsed.query).toString()
      url += `?${queryString}`
    }
    
    // Add hash
    if (parsed.hash) {
      url += `#${parsed.hash}`
    }
    
    return url
  }
}
```

### 3.5.2 상태 복원 매니저

```typescript
interface StateRestorationManager {
  saveState(route: Route, state: any): void
  restoreState(route: Route): any | null
  
  enableAutoSave(interval: number): void
  disableAutoSave(): void
  
  clearState(route?: Route): void
  exportState(): string
  importState(data: string): void
}

class StateRestorationManagerImpl implements StateRestorationManager {
  private stateCache: Map<string, any> = new Map()
  private storageKey = 'apartment_route_state'
  private autoSaveTimer: number | null = null
  
  constructor(private storage: Storage = sessionStorage) {
    this.loadFromStorage()
  }
  
  saveState(route: Route, state: any): void {
    const key = this.getRouteKey(route)
    
    // 메모리에 저장
    this.stateCache.set(key, {
      state,
      timestamp: Date.now(),
      route
    })
    
    // 스토리지에 저장
    this.persistToStorage()
    
    // 메트릭 기록
    this.recordStateSize(key, state)
  }
  
  restoreState(route: Route): any | null {
    const key = this.getRouteKey(route)
    const cached = this.stateCache.get(key)
    
    if (!cached) return null
    
    // 만료 시간 검사
    const maxAge = 30 * 60 * 1000 // 30분
    if (Date.now() - cached.timestamp > maxAge) {
      this.stateCache.delete(key)
      return null
    }
    
    return cached.state
  }
  
  private getRouteKey(route: Route): string {
    const { apartment, building, unit } = route
    return `${apartment}:${building}:${unit}`
  }
  
  private persistToStorage(): void {
    try {
      const data = Array.from(this.stateCache.entries()).map(([key, value]) => ({
        key,
        ...value
      }))
      
      this.storage.setItem(this.storageKey, JSON.stringify(data))
    } catch (error) {
      console.warn('Failed to persist route state:', error)
      
      // 스토리지 용량 초과 시 오래된 항목 제거
      if (error.name === 'QuotaExceededError') {
        this.evictOldestStates()
        this.persistToStorage()
      }
    }
  }
}
```

## 3.6 라우트 미들웨어

### 3.6.1 미들웨어 시스템

```typescript
interface RouteMiddleware {
  name: string
  priority: number
  execute(context: MiddlewareContext, next: MiddlewareNext): void | Promise<void>
}

interface MiddlewareContext {
  from: Route
  to: Route
  params: RouteParams
  query: QueryParams
  meta: Record<string, any>
}

class MiddlewareChain {
  private middlewares: RouteMiddleware[] = []
  
  use(middleware: RouteMiddleware): void {
    this.middlewares.push(middleware)
    this.middlewares.sort((a, b) => b.priority - a.priority)
  }
  
  async execute(context: MiddlewareContext): Promise<void> {
    let index = 0
    
    const next: MiddlewareNext = async () => {
      if (index >= this.middlewares.length) return
      
      const middleware = this.middlewares[index++]
      await middleware.execute(context, next)
    }
    
    await next()
  }
}

// 미들웨어 예시
const loggingMiddleware: RouteMiddleware = {
  name: 'logging',
  priority: 100,
  execute(context, next) {
    console.log(`Navigating from ${context.from.path} to ${context.to.path}`)
    const startTime = performance.now()
    
    next().then(() => {
      const duration = performance.now() - startTime
      console.log(`Navigation completed in ${duration}ms`)
    })
  }
}

const analyticsMiddleware: RouteMiddleware = {
  name: 'analytics',
  priority: 90,
  execute(context, next) {
    // 페이지뷰 추적
    analytics.track('page_view', {
      from: context.from.path,
      to: context.to.path,
      apartment: context.to.apartment,
      building: context.to.building,
      unit: context.to.unit,
      params: context.params,
      query: context.query
    })
    
    next()
  }
}

const preloadMiddleware: RouteMiddleware = {
  name: 'preload',
  priority: 80,
  async execute(context, next) {
    // 다음 가능한 라우트의 리소스 프리로드
    const adjacentRoutes = await this.predictAdjacentRoutes(context.to)
    
    adjacentRoutes.forEach(route => {
      this.preloadRoute(route)
    })
    
    await next()
  }
}
```

## 3.7 고급 라우팅 기능

### 3.7.1 라우트 별칭 및 리디렉션

```typescript
interface RouteAlias {
  from: string
  to: string
  type: 'alias' | 'redirect'
  statusCode?: number
}

class RouteAliasManager {
  private aliases: Map<string, RouteAlias> = new Map()
  
  register(alias: RouteAlias): void {
    this.aliases.set(alias.from, alias)
  }
  
  resolve(path: string): ResolvedRoute {
    const alias = this.aliases.get(path)
    
    if (!alias) {
      return { path, type: 'normal' }
    }
    
    if (alias.type === 'alias') {
      // 별칭: URL은 유지하고 내부적으로 다른 라우트 사용
      return {
        path: alias.to,
        type: 'alias',
        originalPath: path
      }
    } else {
      // 리디렉션: URL도 변경
      return {
        path: alias.to,
        type: 'redirect',
        statusCode: alias.statusCode || 301
      }
    }
  }
}

// 사용 예시
aliasManager.register({
  from: '/dashboard',
  to: '/apartment/main/building/dashboard/unit/active',
  type: 'alias'
})

aliasManager.register({
  from: '/old-login',
  to: '/apartment/auth/building/login/unit/v2',
  type: 'redirect',
  statusCode: 301
})
```

### 3.7.2 중첩 라우트

```typescript
interface NestedRoute extends Route {
  children?: NestedRoute[]
  component?: ComponentDefinition
  layout?: LayoutDefinition
}

class NestedRouteResolver {
  resolve(path: string, routes: NestedRoute[]): RouteResolution {
    const segments = path.split('/').filter(Boolean)
    const matched: NestedRoute[] = []
    let currentRoutes = routes
    
    for (const segment of segments) {
      const route = this.findMatchingRoute(segment, currentRoutes)
      
      if (!route) break
      
      matched.push(route)
      currentRoutes = route.children || []
    }
    
    return {
      matched,
      layouts: this.extractLayouts(matched),
      components: this.extractComponents(matched)
    }
  }
  
  private extractLayouts(routes: NestedRoute[]): LayoutDefinition[] {
    return routes
      .filter(route => route.layout)
      .map(route => route.layout!)
  }
  
  private extractComponents(routes: NestedRoute[]): ComponentDefinition[] {
    return routes
      .filter(route => route.component)
      .map(route => route.component!)
  }
}
```

## 3.8 성능 최적화

### 3.8.1 라우트 프리페칭

```typescript
class RoutePrefetcher {
  private prefetchQueue: Set<string> = new Set()
  private observer: IntersectionObserver
  
  constructor(private router: Router) {
    this.setupLinkObserver()
  }
  
  private setupLinkObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const link = entry.target as HTMLAnchorElement
            const href = link.getAttribute('href')
            
            if (href && this.isInternalLink(href)) {
              this.prefetchRoute(href)
            }
          }
        })
      },
      {
        rootMargin: '50px'
      }
    )
    
    // 모든 내부 링크 관찰
    this.observeLinks()
  }
  
  private async prefetchRoute(path: string): Promise<void> {
    if (this.prefetchQueue.has(path)) return
    
    this.prefetchQueue.add(path)
    
    try {
      const route = this.router.resolve(path)
      if (!route) return
      
      // Unit 모듈 프리로드
      await this.router.preloadUnit(route.building, route.unit)
      
      // 관련 리소스 프리페치
      await this.prefetchResources(route)
      
    } catch (error) {
      console.warn(`Failed to prefetch route: ${path}`, error)
    }
  }
}
```

### 3.8.2 라우트 캐싱

```typescript
class RouteCache {
  private cache: Map<string, CachedRoute> = new Map()
  private maxSize: number = 50
  private maxAge: number = 5 * 60 * 1000 // 5분
  
  get(path: string): Route | null {
    const cached = this.cache.get(path)
    
    if (!cached) return null
    
    // 만료 검사
    if (Date.now() - cached.timestamp > this.maxAge) {
      this.cache.delete(path)
      return null
    }
    
    // LRU 업데이트
    cached.lastAccess = Date.now()
    
    return cached.route
  }
  
  set(path: string, route: Route): void {
    // 캐시 크기 제한
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }
    
    this.cache.set(path, {
      route,
      timestamp: Date.now(),
      lastAccess: Date.now()
    })
  }
  
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    
    for (const [key, cached] of this.cache) {
      if (cached.lastAccess < oldestTime) {
        oldestTime = cached.lastAccess
        oldestKey = key
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }
}
```

## 3.9 에러 처리

### 3.9.1 라우팅 에러 처리

```typescript
interface RouteErrorHandler {
  handle(error: RouteError, context: ErrorContext): void | Promise<void>
}

class RouteErrorManager {
  private handlers: Map<string, RouteErrorHandler> = new Map()
  private fallbackHandler: RouteErrorHandler
  
  constructor() {
    this.registerDefaultHandlers()
  }
  
  async handleError(error: RouteError, context: ErrorContext): Promise<void> {
    const handler = this.handlers.get(error.type) || this.fallbackHandler
    
    try {
      await handler.handle(error, context)
    } catch (handlerError) {
      console.error('Error in error handler:', handlerError)
      // 최후의 수단: 홈으로 리디렉션
      window.location.href = '/'
    }
  }
  
  private registerDefaultHandlers() {
    // 404 처리
    this.handlers.set('NOT_FOUND', {
      handle: async (error, context) => {
        const notFoundUnit = await this.loadNotFoundUnit()
        await this.router.displayUnit(notFoundUnit)
      }
    })
    
    // 권한 없음 처리
    this.handlers.set('FORBIDDEN', {
      handle: async (error, context) => {
        const forbiddenUnit = await this.loadForbiddenUnit()
        await this.router.displayUnit(forbiddenUnit)
      }
    })
    
    // Unit 로드 실패 처리
    this.handlers.set('UNIT_LOAD_FAILED', {
      handle: async (error, context) => {
        // 폴백 Unit 시도
        const fallbackUnit = await this.getFallbackUnit(context.building)
        if (fallbackUnit) {
          await this.router.displayUnit(fallbackUnit)
        } else {
          throw new Error('No fallback unit available')
        }
      }
    })
  }
}
```

## 3.10 통합 및 테스트

### 3.10.1 라우터 통합

```typescript
class ApartmentRouter implements Router {
  private engine: RoutingEngine
  private urlParser: URLParser
  private historyManager: HistoryManager
  private transitionManager: TransitionManager
  private middlewareChain: MiddlewareChain
  private errorManager: RouteErrorManager
  
  constructor(config: RouterConfig) {
    this.engine = new RoutingEngine(config)
    this.urlParser = new ApartmentURLParser()
    this.historyManager = new BrowserHistoryManager()
    this.transitionManager = new TransitionManagerImpl()
    this.middlewareChain = new MiddlewareChain()
    this.errorManager = new RouteErrorManager()
    
    this.initialize()
  }
  
  async navigate(path: string, options?: NavigationOptions): Promise<void> {
    const span = this.startNavigationSpan(path)
    
    try {
      // URL 파싱
      const parsed = this.urlParser.parse(path)
      
      // 라우트 매칭
      const match = this.engine.match(path)
      if (!match) {
        throw new RouteError('NOT_FOUND', path)
      }
      
      // 가드 실행
      const guardsPassed = await this.executeGuards(match)
      if (!guardsPassed) return
      
      // 미들웨어 실행
      await this.executeMiddleware(match)
      
      // 트랜지션 시작
      const from = this.getCurrentRoute()
      await this.transitionManager.beforeTransition(from, match.route)
      
      // Unit 전환
      await this.switchUnit(match)
      
      // 트랜지션 완료
      await this.transitionManager.afterTransition(from, match.route)
      
      // 히스토리 업데이트
      this.historyManager.push(match.route, options?.state)
      
      span.setStatus({ code: 'ok' })
      
    } catch (error) {
      span.setStatus({ code: 'error', message: error.message })
      await this.errorManager.handleError(error, { path, options })
      
    } finally {
      span.end()
    }
  }
}
```

## 3.11 결론

Apartment 라우팅 시스템은 대규모 마이크로 프론트엔드 애플리케이션을 위한 강력하고 유연한 네비게이션 솔루션을 제공합니다.

### 주요 특징
1. **체계적인 주소 체계**: 동/호수 메타포로 직관적인 모듈 관리
2. **동적 Unit 선택**: 다양한 배포 전략 지원 (Canary, A/B Test 등)
3. **강력한 가드 시스템**: 세밀한 접근 제어 및 네비게이션 제어
4. **성능 최적화**: 프리페칭, 캐싱, 지능적 리소스 관리
5. **풍부한 트랜지션**: 부드러운 사용자 경험 제공

이 시스템을 통해 복잡한 엔터프라이즈 애플리케이션에서도 일관되고 예측 가능한 라우팅 경험을 제공할 수 있습니다. 