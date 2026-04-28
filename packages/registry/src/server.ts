import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { join } from 'path'
import { RegistryStorage } from './storage/RegistryStorage'
import { ContainerRepository } from './repository/ContainerRepository'
import { AuthService } from './auth/AuthService'
import { MetricsService } from './metrics/MetricsService'
import type { RegistryConfig } from './types'

const DEFAULT_CONFIG: RegistryConfig = {
  port: 5000,
  host: '0.0.0.0',
  storage: {
    type: 'filesystem',
    path: './data/registry'
  },
  auth: {
    enabled: false,
    type: 'basic'
  },
  metrics: {
    enabled: true,
    endpoint: '/metrics'
  },
  cors: {
    origin: true,
    credentials: true
  },
  rateLimit: {
    max: 100,
    timeWindow: '1 minute'
  }
}

export class RegistryServer {
  private server = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  })
  
  private storage: RegistryStorage
  private repository: ContainerRepository
  private authService: AuthService
  private metricsService: MetricsService
  private config: RegistryConfig

  constructor(config: Partial<RegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    // 서비스 초기화
    this.storage = new RegistryStorage(this.config.storage)
    this.repository = new ContainerRepository(this.storage)
    this.authService = new AuthService(this.config.auth)
    this.metricsService = new MetricsService(this.config.metrics)
  }

  async start(): Promise<void> {
    await this.setupMiddleware()
    await this.setupRoutes()
    await this.storage.initialize()

    const address = await this.server.listen({
      port: this.config.port,
      host: this.config.host
    })

    this.server.log.info(`Gaesup Container Registry listening at ${address}`)
  }

  async stop(): Promise<void> {
    await this.server.close()
    await this.storage.close()
  }

  private async setupMiddleware(): Promise<void> {
    // CORS
    await this.server.register(cors, this.config.cors)

    // Security
    await this.server.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      }
    })

    // Rate limiting
    await this.server.register(rateLimit, this.config.rateLimit)

    // File uploads
    await this.server.register(multipart, {
      limits: {
        fileSize: 100 * 1024 * 1024 // 100MB max
      }
    })

    // Static files for web UI
    await this.server.register(staticFiles, {
      root: join(process.cwd(), 'public'),
      prefix: '/ui/'
    })

    // Request logging
    this.server.addHook('onRequest', async (request) => {
      this.metricsService.recordRequest(request.method, request.url)
    })

    // Authentication hook
    this.server.addHook('preHandler', async (request, reply) => {
      if (this.config.auth.enabled) {
        const isPublicRoute = this.isPublicRoute(request.url)
        if (!isPublicRoute) {
          await this.authService.authenticate(request, reply)
        }
      }
    })
  }

  private async setupRoutes(): Promise<void> {
    // Health check
    this.server.get('/health', async () => ({
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      storage: await this.storage.getHealth()
    }))

    // Container Registry API v2 compatible endpoints
    await this.setupV2API()

    // Gaesup-specific API
    await this.setupGaesupAPI()

    // Web UI
    this.server.get('/ui', async (_request, reply) => {
      return reply.sendFile('index.html')
    })

    // Metrics
    if (this.config.metrics.enabled) {
      this.server.get(this.config.metrics.endpoint, async () => {
        return this.metricsService.getMetrics()
      })
    }
  }

  private async setupV2API(): Promise<void> {
    const v2Routes = {
      // Docker Registry API v2 호환성
      
      // API 버전 체크
      'GET /v2/': async () => ({
        message: 'Gaesup Container Registry API v2'
      }),

      // 컨테이너 목록
      'GET /v2/_catalog': async (request: any) => {
        const { n, last } = request.query
        const containers = await this.repository.listContainers(n, last)
        return { repositories: containers }
      },

      // 태그 목록
      'GET /v2/:name/tags/list': async (request: any) => {
        const { name } = request.params
        const tags = await this.repository.listTags(name)
        return { name, tags }
      },

      // 매니페스트 조회
      'GET /v2/:name/manifests/:reference': async (request: any, reply: any) => {
        const { name, reference } = request.params
        const manifest = await this.repository.getManifest(name, reference)
        
        if (!manifest) {
          return reply.code(404).send({ error: 'Manifest not found' })
        }

        return manifest
      },

      // 매니페스트 업로드
      'PUT /v2/:name/manifests/:reference': async (request: any) => {
        const { name, reference } = request.params
        const manifest = request.body

        await this.repository.putManifest(name, reference, manifest)
        
        return { status: 'uploaded' }
      },

      // 블롭 업로드 시작
      'POST /v2/:name/blobs/uploads/': async (request: any) => {
        const { name } = request.params
        const uploadId = await this.repository.startBlobUpload(name)
        
        return {
          uuid: uploadId,
          location: `/v2/${name}/blobs/uploads/${uploadId}`
        }
      },

      // 블롭 업로드 완료
      'PUT /v2/:name/blobs/uploads/:uuid': async (request: any, reply: any) => {
        const { name, uuid } = request.params
        const { digest } = request.query
        const data = await request.file()

        if (!data) {
          return reply.code(400).send({ error: 'No file provided' })
        }

        await this.repository.completeBlobUpload(name, uuid, digest, data.file)
        
        return { status: 'uploaded' }
      },

      // 블롭 조회
      'GET /v2/:name/blobs/:digest': async (request: any, reply: any) => {
        const { name, digest } = request.params
        const blob = await this.repository.getBlob(name, digest)

        if (!blob) {
          return reply.code(404).send({ error: 'Blob not found' })
        }

        return reply.type('application/octet-stream').send(blob)
      }
    }

    // 라우트 등록
    for (const [route, handler] of Object.entries(v2Routes)) {
      const [method, path] = route.split(' ')
      this.server.route({
        method: method as any,
        url: path,
        handler
      })
    }
  }

  private async setupGaesupAPI(): Promise<void> {
    // Gaesup 특화 API

    // 컨테이너 검색
    this.server.get('/api/v1/search', async (request: any) => {
      const { q, limit = 10, offset = 0 } = request.query
      return await this.repository.searchContainers(q, limit, offset)
    })

    // 컨테이너 상세 정보
    this.server.get('/api/v1/containers/:name', async (request: any, reply: any) => {
      const { name } = request.params
      const container = await this.repository.getContainerInfo(name)
      
      if (!container) {
        return reply.code(404).send({ error: 'Container not found' })
      }

      return container
    })

    // 컨테이너 통계
    this.server.get('/api/v1/containers/:name/stats', async (request: any) => {
      const { name } = request.params
      return await this.repository.getContainerStats(name)
    })

    // 인기 컨테이너
    this.server.get('/api/v1/popular', async (request: any) => {
      const { limit = 10 } = request.query
      return await this.repository.getPopularContainers(limit)
    })

    // 최근 컨테이너
    this.server.get('/api/v1/recent', async (request: any) => {
      const { limit = 10 } = request.query
      return await this.repository.getRecentContainers(limit)
    })

    // 컨테이너 삭제
    this.server.delete('/api/v1/containers/:name', async (request: any) => {
      const { name } = request.params
      await this.repository.deleteContainer(name)
      return { status: 'deleted' }
    })

    // 태그 삭제
    this.server.delete('/api/v1/containers/:name/tags/:tag', async (request: any) => {
      const { name, tag } = request.params
      await this.repository.deleteTag(name, tag)
      return { status: 'deleted' }
    })

    // 빌드 트리거 (Webhook)
    this.server.post('/api/v1/containers/:name/builds', async (request: any) => {
      const { name } = request.params
      const { repository, branch = 'main' } = request.body

      // 빌드 작업 큐에 추가 (실제 구현에서는 백그라운드 작업)
      const buildId = await this.repository.triggerBuild(name, repository, branch)
      
      return { buildId, status: 'queued' }
    })
  }

  private isPublicRoute(url: string): boolean {
    const publicRoutes = [
      '/health',
      '/v2/',
      '/ui',
      '/api/v1/search',
      '/api/v1/popular',
      '/api/v1/recent'
    ]

    return publicRoutes.some(route => url.startsWith(route))
  }
}

// 서버 시작 (직접 실행 시)
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: Partial<RegistryConfig> = {
    port: parseInt(process.env.PORT || '5000', 10),
    storage: {
      type: process.env.STORAGE_TYPE as any || 'filesystem',
      path: process.env.STORAGE_PATH || './data/registry'
    },
    auth: {
      enabled: process.env.AUTH_ENABLED === 'true',
      type: process.env.AUTH_TYPE as any || 'basic',
      username: process.env.AUTH_USERNAME,
      password: process.env.AUTH_PASSWORD
    }
  }

  const server = new RegistryServer(config)
  
  server.start().catch(error => {
    console.error('Failed to start registry server:', error)
    process.exit(1)
  })

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...')
    await server.stop()
    process.exit(0)
  })
} 