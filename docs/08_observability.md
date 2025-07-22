# 8. Observability 및 모니터링 시스템 계획

## 8.1 개요

Observability 시스템은 아파트 단지의 "종합 관제센터" 역할로, 모든 Building/Unit의 상태를 실시간으로 추적하고 문제를 조기에 감지합니다.

### 핵심 목표
- **통합 가시성**: 모든 Unit의 상태를 한눈에 파악
- **실시간 모니터링**: 성능 지표 및 오류 실시간 추적
- **지능형 알림**: 패턴 기반 이상 상황 감지
- **근본 원인 분석**: 분산 추적을 통한 문제 원인 파악

## 8.2 관측성 데이터 계층

### 8.2.1 텔레메트리 데이터 분류

```typescript
interface ObservabilityData {
  // 메트릭 (정량적 측정값)
  metrics: {
    performance: PerformanceMetrics
    business: BusinessMetrics
    infrastructure: InfrastructureMetrics
    custom: CustomMetrics
  }
  
  // 로그 (이벤트 기록)
  logs: {
    application: ApplicationLog[]
    system: SystemLog[]
    security: SecurityLog[]
    user: UserActionLog[]
  }
  
  // 추적 (분산 트랜잭션)
  traces: {
    requests: RequestTrace[]
    userJourneys: UserJourneyTrace[]
    containerLifecycle: LifecycleTrace[]
  }
  
  // 알림 (문제 감지)
  alerts: {
    performance: PerformanceAlert[]
    errors: ErrorAlert[]
    security: SecurityAlert[]
    business: BusinessAlert[]
  }
}

interface PerformanceMetrics {
  // 컨테이너 성능
  containerLoadTime: number        // 컨테이너 로드 시간
  containerMemoryUsage: number     // 메모리 사용량
  containerCpuUsage: number        // CPU 사용률
  
  // 사용자 경험
  firstContentfulPaint: number     // FCP
  largestContentfulPaint: number   // LCP
  firstInputDelay: number          // FID
  cumulativeLayoutShift: number    // CLS
  
  // 네트워크
  responseTime: number             // 응답 시간
  throughput: number               // 처리량
  errorRate: number                // 오류율
}
```

### 8.2.2 데이터 수집 에이전트

```typescript
class ObservabilityAgent {
  private collectors: Map<string, DataCollector> = new Map()
  private transport: TelemetryTransport
  private config: ObservabilityConfig
  
  constructor(config: ObservabilityConfig) {
    this.config = config
    this.transport = new TelemetryTransport(config.endpoint)
    this.setupCollectors()
  }
  
  private setupCollectors(): void {
    // 성능 메트릭 수집
    this.collectors.set('performance', new PerformanceCollector({
      interval: 1000,
      metrics: ['FCP', 'LCP', 'FID', 'CLS', 'memory', 'cpu']
    }))
    
    // 사용자 행동 추적
    this.collectors.set('user-actions', new UserActionCollector({
      trackClicks: true,
      trackNavigation: true,
      trackFormSubmissions: true,
      piiFilter: true // 개인정보 필터링
    }))
    
    // 에러 수집
    this.collectors.set('errors', new ErrorCollector({
      captureUnhandledExceptions: true,
      captureUnhandledRejections: true,
      captureConsoleErrors: true,
      sourceMaps: true
    }))
    
    // 네트워크 추적
    this.collectors.set('network', new NetworkCollector({
      interceptFetch: true,
      interceptXHR: true,
      trackLatency: true,
      trackPayloadSize: true
    }))
  }
  
  // 커스텀 메트릭 추가
  track(event: string, properties: Record<string, any> = {}): void {
    const telemetryEvent: TelemetryEvent = {
      type: 'custom',
      name: event,
      properties: {
        ...properties,
        unitId: this.getCurrentUnitId(),
        apartmentId: this.getCurrentApartmentId(),
        timestamp: Date.now(),
        sessionId: this.getSessionId()
      }
    }
    
    this.transport.send(telemetryEvent)
  }
  
  // 성능 측정
  measure(name: string, fn: () => Promise<any>): Promise<any> {
    const startTime = performance.now()
    const span = this.startSpan(name)
    
    return fn()
      .then(result => {
        const duration = performance.now() - startTime
        span.setTag('success', true)
        span.setTag('duration', duration)
        this.track('performance.measure', { name, duration, success: true })
        return result
      })
      .catch(error => {
        const duration = performance.now() - startTime
        span.setTag('success', false)
        span.setTag('error', error.message)
        this.track('performance.measure', { name, duration, success: false, error: error.message })
        throw error
      })
      .finally(() => {
        span.finish()
      })
  }
  
  // 분산 추적 스팬 생성
  startSpan(operationName: string, parentSpan?: Span): Span {
    return new Span({
      operationName,
      parentSpan,
      tags: {
        unitId: this.getCurrentUnitId(),
        apartmentId: this.getCurrentApartmentId(),
        framework: this.getCurrentFramework()
      }
    })
  }
}
```

## 8.3 실시간 모니터링 대시보드

### 8.3.1 대시보드 구성

```typescript
interface MonitoringDashboard {
  // 개요 패널
  overview: {
    activeUnits: number
    totalRequests: number
    averageResponseTime: number
    errorRate: number
    uptime: number
  }
  
  // Unit별 상태
  unitStatus: Array<{
    unitId: string
    status: 'healthy' | 'warning' | 'critical'
    metrics: UnitMetrics
    alerts: Alert[]
  }>
  
  // 실시간 차트
  charts: {
    responseTime: TimeSeriesChart
    memoryUsage: TimeSeriesChart
    errorRate: TimeSeriesChart
    userActivity: TimeSeriesChart
  }
  
  // 알림 센터
  alertCenter: {
    active: Alert[]
    recent: Alert[]
    configuration: AlertConfig[]
  }
}

class DashboardRenderer {
  private metricsStore: MetricsStore
  private alertManager: AlertManager
  
  constructor() {
    this.metricsStore = new MetricsStore()
    this.alertManager = new AlertManager()
  }
  
  renderDashboard(): HTMLElement {
    const dashboard = document.createElement('div')
    dashboard.className = 'monitoring-dashboard'
    
    dashboard.innerHTML = `
      <div class="dashboard-header">
        <h1>Gaesup-State Monitoring</h1>
        <div class="status-indicators">
          ${this.renderStatusIndicators()}
        </div>
      </div>
      
      <div class="dashboard-grid">
        <div class="overview-panel">
          ${this.renderOverviewPanel()}
        </div>
        
        <div class="unit-grid">
          ${this.renderUnitGrid()}
        </div>
        
        <div class="charts-panel">
          ${this.renderChartsPanel()}
        </div>
        
        <div class="alerts-panel">
          ${this.renderAlertsPanel()}
        </div>
      </div>
    `
    
    this.setupRealTimeUpdates(dashboard)
    return dashboard
  }
  
  private setupRealTimeUpdates(dashboard: HTMLElement): void {
    // WebSocket 연결
    const ws = new WebSocket(this.config.metricsStreamUrl)
    
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data)
      
      switch (update.type) {
        case 'metrics_update':
          this.updateMetricsDisplay(dashboard, update.data)
          break
          
        case 'alert_triggered':
          this.showAlert(dashboard, update.alert)
          break
          
        case 'unit_status_change':
          this.updateUnitStatus(dashboard, update.unitId, update.status)
          break
      }
    }
    
    // 주기적 업데이트
    setInterval(() => {
      this.refreshDashboard(dashboard)
    }, 5000) // 5초마다
  }
}
```

### 8.3.2 차트 및 시각화

```typescript
class MetricsVisualization {
  private chartInstances: Map<string, Chart> = new Map()
  
  createResponseTimeChart(container: HTMLElement): Chart {
    const chart = new Chart(container, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Response Time (ms)',
          data: [],
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'time',
            time: {
              displayFormats: {
                minute: 'HH:mm',
                hour: 'HH:mm'
              }
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Response Time (ms)'
            }
          }
        },
        plugins: {
          legend: {
            display: true
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        }
      }
    })
    
    this.chartInstances.set('responseTime', chart)
    return chart
  }
  
  updateChart(chartId: string, dataPoints: DataPoint[]): void {
    const chart = this.chartInstances.get(chartId)
    if (!chart) return
    
    // 새 데이터 포인트 추가
    dataPoints.forEach(point => {
      chart.data.datasets[0].data.push({
        x: point.timestamp,
        y: point.value
      })
    })
    
    // 오래된 데이터 제거 (최근 1시간만 유지)
    const cutoffTime = Date.now() - (60 * 60 * 1000)
    chart.data.datasets[0].data = chart.data.datasets[0].data.filter(
      (point: any) => point.x > cutoffTime
    )
    
    chart.update('none') // 애니메이션 없이 업데이트
  }
  
  createUnitHealthMatrix(): HTMLElement {
    const matrix = document.createElement('div')
    matrix.className = 'unit-health-matrix'
    
    const units = this.getActiveUnits()
    
    matrix.innerHTML = `
      <div class="matrix-header">
        <h3>Unit Health Matrix</h3>
      </div>
      
      <div class="matrix-grid">
        ${units.map(unit => `
          <div class="unit-cell ${this.getHealthClass(unit.health)}" 
               data-unit-id="${unit.id}"
               title="${unit.name} - ${unit.health}%">
            <div class="unit-label">${unit.shortName}</div>
            <div class="health-indicator">${unit.health}%</div>
          </div>
        `).join('')}
      </div>
    `
    
    return matrix
  }
}
```

## 8.4 지능형 알림 시스템

### 8.4.1 알림 규칙 엔진

```typescript
class AlertRuleEngine {
  private rules: Map<string, AlertRule> = new Map()
  private evaluationInterval: number = 60000 // 1분
  
  constructor() {
    this.setupDefaultRules()
    this.startEvaluation()
  }
  
  private setupDefaultRules(): void {
    // 응답 시간 임계값
    this.addRule('high_response_time', {
      name: 'High Response Time',
      condition: (metrics) => metrics.averageResponseTime > 2000,
      severity: 'warning',
      description: '평균 응답 시간이 2초를 초과했습니다',
      cooldown: 300000, // 5분
      actions: ['notify_team', 'create_incident']
    })
    
    // 메모리 사용량 임계값
    this.addRule('high_memory_usage', {
      name: 'High Memory Usage',
      condition: (metrics) => metrics.memoryUsage > 0.8,
      severity: 'critical',
      description: '메모리 사용량이 80%를 초과했습니다',
      cooldown: 180000, // 3분
      actions: ['notify_team', 'scale_containers', 'create_incident']
    })
    
    // 에러율 임계값
    this.addRule('high_error_rate', {
      name: 'High Error Rate',
      condition: (metrics) => metrics.errorRate > 0.05,
      severity: 'critical',
      description: '에러율이 5%를 초과했습니다',
      cooldown: 60000, // 1분
      actions: ['notify_team', 'rollback_if_recent_deployment']
    })
    
    // 사용자 세션 급감
    this.addRule('session_drop', {
      name: 'Session Drop',
      condition: (current, previous) => {
        return previous && (current.activeSessions / previous.activeSessions) < 0.7
      },
      severity: 'warning',
      description: '활성 세션이 30% 이상 감소했습니다',
      cooldown: 600000 // 10분
    })
  }
  
  async evaluateRules(): Promise<void> {
    const currentMetrics = await this.metricsCollector.getCurrentMetrics()
    const previousMetrics = await this.metricsCollector.getPreviousMetrics()
    
    for (const [ruleId, rule] of this.rules) {
      try {
        const shouldAlert = await this.evaluateRule(rule, currentMetrics, previousMetrics)
        
        if (shouldAlert && this.canTriggerAlert(ruleId)) {
          await this.triggerAlert(ruleId, rule, currentMetrics)
        }
      } catch (error) {
        console.error(`Error evaluating rule ${ruleId}:`, error)
      }
    }
  }
  
  private async triggerAlert(
    ruleId: string,
    rule: AlertRule,
    metrics: Metrics
  ): Promise<void> {
    const alert: Alert = {
      id: this.generateAlertId(),
      ruleId,
      name: rule.name,
      severity: rule.severity,
      description: rule.description,
      timestamp: new Date(),
      metrics,
      status: 'firing'
    }
    
    // 알림 액션 실행
    for (const action of rule.actions) {
      await this.executeAction(action, alert)
    }
    
    // 쿨다운 설정
    this.setAlertCooldown(ruleId, rule.cooldown)
    
    // 알림 저장
    await this.alertStorage.saveAlert(alert)
    
    // 실시간 알림 전송
    this.notificationService.broadcast('alert.triggered', alert)
  }
  
  private async executeAction(action: string, alert: Alert): Promise<void> {
    switch (action) {
      case 'notify_team':
        await this.notificationService.notifyTeam(alert)
        break
        
      case 'create_incident':
        await this.incidentManager.createIncident(alert)
        break
        
      case 'scale_containers':
        await this.autoScaler.scaleUp(alert.metrics.unitId)
        break
        
      case 'rollback_if_recent_deployment':
        await this.deploymentManager.rollbackIfRecent(alert.metrics.unitId)
        break
    }
  }
}
```

### 8.4.2 알림 채널 관리

```typescript
class NotificationService {
  private channels: Map<string, NotificationChannel> = new Map()
  
  constructor() {
    this.setupChannels()
  }
  
  private setupChannels(): void {
    // 슬랙 채널
    this.channels.set('slack', new SlackChannel({
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: '#gaesup-alerts',
      username: 'Gaesup Monitor'
    }))
    
    // 이메일 채널
    this.channels.set('email', new EmailChannel({
      smtpConfig: process.env.SMTP_CONFIG,
      templates: {
        critical: 'critical-alert-template',
        warning: 'warning-alert-template'
      }
    }))
    
    // Discord 채널
    this.channels.set('discord', new DiscordChannel({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL
    }))
    
    // SMS 채널 (critical alerts only)
    this.channels.set('sms', new SMSChannel({
      provider: 'twilio',
      config: process.env.TWILIO_CONFIG,
      onlyFor: ['critical']
    }))
  }
  
  async notifyTeam(alert: Alert): Promise<void> {
    const channels = this.getChannelsForSeverity(alert.severity)
    
    const notifications = channels.map(channel => 
      this.sendToChannel(channel, alert)
    )
    
    await Promise.allSettled(notifications)
  }
  
  private async sendToChannel(
    channelId: string,
    alert: Alert
  ): Promise<void> {
    const channel = this.channels.get(channelId)
    if (!channel) return
    
    const message = this.formatAlertMessage(alert, channel.getFormat())
    
    try {
      await channel.send(message)
    } catch (error) {
      console.error(`Failed to send alert to ${channelId}:`, error)
    }
  }
  
  private formatAlertMessage(alert: Alert, format: 'slack' | 'email' | 'sms'): any {
    switch (format) {
      case 'slack':
        return {
          text: `🚨 ${alert.name}`,
          attachments: [{
            color: this.getSeverityColor(alert.severity),
            fields: [
              { title: 'Severity', value: alert.severity, short: true },
              { title: 'Unit ID', value: alert.metrics.unitId, short: true },
              { title: 'Description', value: alert.description, short: false },
              { title: 'Timestamp', value: alert.timestamp.toISOString(), short: true }
            ]
          }]
        }
        
      case 'email':
        return {
          subject: `[${alert.severity.toUpperCase()}] ${alert.name}`,
          html: this.generateEmailHTML(alert),
          to: this.getEmailRecipients(alert.severity)
        }
        
      case 'sms':
        return {
          text: `ALERT: ${alert.name} - ${alert.description}`,
          to: this.getSMSRecipients()
        }
    }
  }
}
```

## 8.5 성능 분석 및 최적화

### 8.5.1 성능 프로파일링

```typescript
class PerformanceProfiler {
  private profiles: Map<string, PerformanceProfile> = new Map()
  private sampler: PerformanceSampler
  
  constructor() {
    this.sampler = new PerformanceSampler({
      sampleRate: 0.1, // 10% 샘플링
      interval: 1000   // 1초마다
    })
  }
  
  startProfiling(unitId: string): ProfileSession {
    const session = new ProfileSession(unitId)
    
    // CPU 프로파일링
    session.addProfiler('cpu', new CPUProfiler({
      stackDepth: 20,
      sampleInterval: 10
    }))
    
    // 메모리 프로파일링
    session.addProfiler('memory', new MemoryProfiler({
      trackAllocations: true,
      trackLeaks: true
    }))
    
    // 렌더링 성능
    session.addProfiler('rendering', new RenderingProfiler({
      trackRepaints: true,
      trackLayoutShifts: true
    }))
    
    session.start()
    return session
  }
  
  async generatePerformanceReport(unitId: string): Promise<PerformanceReport> {
    const metrics = await this.metricsCollector.getMetrics(unitId, {
      timeRange: '24h',
      granularity: '1h'
    })
    
    const analysis = this.analyzePerformanceData(metrics)
    
    return {
      unitId,
      timeRange: '24h',
      summary: analysis.summary,
      bottlenecks: analysis.bottlenecks,
      recommendations: analysis.recommendations,
      trends: analysis.trends,
      comparisons: await this.compareWithPeers(unitId, metrics)
    }
  }
  
  private analyzePerformanceData(metrics: TimeSeriesMetrics): PerformanceAnalysis {
    const analysis: PerformanceAnalysis = {
      summary: this.calculateSummaryStats(metrics),
      bottlenecks: [],
      recommendations: [],
      trends: this.calculateTrends(metrics)
    }
    
    // 병목 현상 감지
    if (metrics.averageResponseTime > 1000) {
      analysis.bottlenecks.push({
        type: 'high_latency',
        severity: 'medium',
        description: '평균 응답 시간이 1초를 초과합니다',
        affectedMetrics: ['responseTime']
      })
    }
    
    if (metrics.memoryUsage.peak > 0.8) {
      analysis.bottlenecks.push({
        type: 'memory_pressure',
        severity: 'high',
        description: '메모리 사용량이 임계값에 근접합니다',
        affectedMetrics: ['memoryUsage']
      })
    }
    
    // 개선 권장사항 생성
    analysis.recommendations = this.generateRecommendations(analysis.bottlenecks)
    
    return analysis
  }
}
```

### 8.5.2 자동 최적화 제안

```typescript
class OptimizationAdvisor {
  private patterns: Map<string, OptimizationPattern> = new Map()
  
  constructor() {
    this.setupOptimizationPatterns()
  }
  
  private setupOptimizationPatterns(): void {
    // 메모리 누수 패턴
    this.patterns.set('memory_leak', {
      detect: (metrics) => {
        const memoryTrend = this.calculateTrend(metrics.memoryUsage)
        return memoryTrend.slope > 0.1 && memoryTrend.confidence > 0.8
      },
      recommend: () => ({
        title: '메모리 누수 의심',
        description: '메모리 사용량이 지속적으로 증가하고 있습니다',
        actions: [
          '이벤트 리스너 정리 확인',
          'setTimeout/setInterval 정리 확인',
          '큰 객체 참조 해제 확인',
          '메모리 프로파일링 수행'
        ],
        priority: 'high'
      })
    })
    
    // 번들 크기 최적화
    this.patterns.set('large_bundle', {
      detect: (metrics) => metrics.bundleSize > 500 * 1024, // 500KB
      recommend: () => ({
        title: '번들 크기 최적화',
        description: '번들 크기가 권장 크기를 초과합니다',
        actions: [
          'Tree shaking 적용',
          '동적 import 사용',
          '라이브러리 대안 검토',
          '코드 분할 적용'
        ],
        priority: 'medium'
      })
    })
    
    // 렌더링 성능 개선
    this.patterns.set('poor_rendering', {
      detect: (metrics) => {
        return metrics.cumulativeLayoutShift > 0.1 || 
               metrics.firstInputDelay > 100
      },
      recommend: () => ({
        title: '렌더링 성능 개선',
        description: 'CLS 또는 FID 지표가 권장값을 초과합니다',
        actions: [
          '이미지 크기 사전 지정',
          '폰트 로딩 최적화',
          'JavaScript 실행 최적화',
          'Critical CSS 인라인화'
        ],
        priority: 'medium'
      })
    })
  }
  
  async generateOptimizationPlan(unitId: string): Promise<OptimizationPlan> {
    const metrics = await this.getUnitMetrics(unitId)
    const detectedIssues: OptimizationRecommendation[] = []
    
    for (const [patternId, pattern] of this.patterns) {
      if (pattern.detect(metrics)) {
        detectedIssues.push(pattern.recommend())
      }
    }
    
    return {
      unitId,
      timestamp: new Date(),
      issues: detectedIssues,
      estimatedImpact: this.calculateImpact(detectedIssues),
      implementationOrder: this.prioritizeRecommendations(detectedIssues)
    }
  }
}
```

---

이 Observability 시스템을 통해 **분산된 모듈 환경에서도 통합된 가시성**을 확보할 수 있으며, **지능형 모니터링과 자동 최적화**로 시스템 안정성을 보장할 수 있습니다. 