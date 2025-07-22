import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { createHash } from 'crypto'
import * as tar from 'tar'
import type { ContainerManifest, BuildOptions, ContainerLayer } from '../types'

export class ContainerBuilder {
  private manifest: ContainerManifest
  private layers: ContainerLayer[] = []
  private buildContext: string

  constructor(buildContext: string) {
    this.buildContext = buildContext
    this.manifest = {
      version: '1.0',
      name: '',
      tag: 'latest',
      architecture: 'wasm32',
      os: 'wasi',
      created: new Date().toISOString(),
      layers: [],
      config: {
        runtime: 'browser',
        maxMemory: 100 * 1024 * 1024, // 100MB
        maxCpuTime: 5000, // 5 seconds
        isolation: {
          memoryIsolation: true,
          fileSystemAccess: false,
          crossContainerComm: false
        }
      }
    }
  }

  // 컨테이너 파일 추가
  async addFile(sourcePath: string, destPath: string): Promise<void> {
    const fullSourcePath = join(this.buildContext, sourcePath)
    const fileContent = await readFile(fullSourcePath)
    const hash = this.calculateHash(fileContent)

    const layer: ContainerLayer = {
      type: 'file',
      source: sourcePath,
      destination: destPath,
      hash,
      size: fileContent.byteLength,
      mediaType: this.getMediaType(sourcePath)
    }

    this.layers.push(layer)
    this.manifest.layers.push({
      digest: `sha256:${hash}`,
      size: fileContent.byteLength,
      mediaType: layer.mediaType
    })
  }

  // WASM 바이너리 추가
  async addWasmBinary(wasmPath: string, entrypoint?: string): Promise<void> {
    const fullWasmPath = join(this.buildContext, wasmPath)
    const wasmContent = await readFile(fullWasmPath)

    // WASM 모듈 검증
    try {
      await WebAssembly.compile(wasmContent)
    } catch (error) {
      throw new Error(`Invalid WASM binary: ${error.message}`)
    }

    const hash = this.calculateHash(wasmContent)

    const layer: ContainerLayer = {
      type: 'wasm',
      source: wasmPath,
      destination: '/app/main.wasm',
      hash,
      size: wasmContent.byteLength,
      mediaType: 'application/wasm',
      entrypoint: entrypoint || 'main'
    }

    this.layers.push(layer)
    this.manifest.layers.push({
      digest: `sha256:${hash}`,
      size: wasmContent.byteLength,
      mediaType: 'application/wasm'
    })

    // 메인 WASM 파일로 설정
    this.manifest.config.entrypoint = entrypoint || 'main'
  }

  // 환경 변수 설정
  setEnvironment(env: Record<string, string>): void {
    this.manifest.config.environment = env
  }

  // 런타임 설정
  setRuntime(runtime: string): void {
    this.manifest.config.runtime = runtime
  }

  // 메모리 제한 설정
  setMemoryLimit(bytes: number): void {
    this.manifest.config.maxMemory = bytes
  }

  // CPU 시간 제한 설정
  setCpuTimeLimit(ms: number): void {
    this.manifest.config.maxCpuTime = ms
  }

  // 컨테이너 이름 및 태그 설정
  setNameAndTag(name: string, tag: string = 'latest'): void {
    this.manifest.name = name
    this.manifest.tag = tag
  }

  // 라벨 추가
  addLabel(key: string, value: string): void {
    if (!this.manifest.config.labels) {
      this.manifest.config.labels = {}
    }
    this.manifest.config.labels[key] = value
  }

  // 컨테이너 빌드
  async build(options: BuildOptions): Promise<string> {
    const { outputPath, compress = true } = options

    // 출력 디렉터리 생성
    await mkdir(dirname(outputPath), { recursive: true })

    // 매니페스트 완성
    this.manifest.created = new Date().toISOString()
    this.manifest.size = this.layers.reduce((sum, layer) => sum + layer.size, 0)

    // 컨테이너 이미지 생성
    const containerData = {
      manifest: this.manifest,
      layers: this.layers,
      files: await this.collectFiles()
    }

    if (compress) {
      // TAR.GZ로 압축
      await this.createCompressedImage(containerData, outputPath)
    } else {
      // JSON으로 저장
      await writeFile(outputPath, JSON.stringify(containerData, null, 2))
    }

    const imageHash = this.calculateHash(Buffer.from(JSON.stringify(containerData)))
    return imageHash
  }

  // Dockerfile 스타일 명령어 파싱
  async fromDockerfile(dockerfilePath: string): Promise<void> {
    const dockerfileContent = await readFile(dockerfilePath, 'utf-8')
    const lines = dockerfileContent.split('\n').map(line => line.trim())

    for (const line of lines) {
      if (line.startsWith('#') || !line) continue

      const [command, ...args] = line.split(/\s+/)
      
      switch (command.toUpperCase()) {
        case 'FROM':
          // WASM 베이스 이미지 (현재는 무시)
          break
          
        case 'COPY':
          if (args.length >= 2) {
            await this.addFile(args[0], args[1])
          }
          break
          
        case 'ADD':
          if (args.length >= 2) {
            if (args[0].endsWith('.wasm')) {
              await this.addWasmBinary(args[0])
            } else {
              await this.addFile(args[0], args[1])
            }
          }
          break
          
        case 'ENV':
          if (args.length >= 2) {
            const [key, value] = args.join(' ').split('=')
            this.setEnvironment({ [key]: value })
          }
          break
          
        case 'LABEL':
          if (args.length >= 2) {
            const [key, value] = args.join(' ').split('=')
            this.addLabel(key.replace(/"/g, ''), value.replace(/"/g, ''))
          }
          break
          
        case 'MEMORY':
          if (args[0]) {
            this.setMemoryLimit(this.parseMemorySize(args[0]))
          }
          break
          
        case 'RUNTIME':
          if (args[0]) {
            this.setRuntime(args[0])
          }
          break
      }
    }
  }

  // 파일들 수집
  private async collectFiles(): Promise<Record<string, Buffer>> {
    const files: Record<string, Buffer> = {}
    
    for (const layer of this.layers) {
      const sourcePath = join(this.buildContext, layer.source)
      const content = await readFile(sourcePath)
      files[layer.destination] = content
    }
    
    return files
  }

  // 압축된 이미지 생성
  private async createCompressedImage(
    containerData: any, 
    outputPath: string
  ): Promise<void> {
    // 임시 디렉터리에 파일들 생성
    const tempDir = join(dirname(outputPath), '.tmp')
    await mkdir(tempDir, { recursive: true })

    // 매니페스트 저장
    await writeFile(
      join(tempDir, 'manifest.json'),
      JSON.stringify(containerData.manifest, null, 2)
    )

    // 레이어 파일들 저장
    for (const [path, content] of Object.entries(containerData.files)) {
      const filePath = join(tempDir, path.replace(/^\//, ''))
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, content as Buffer)
    }

    // TAR.GZ 압축
    await tar.create(
      {
        gzip: true,
        file: outputPath,
        cwd: tempDir
      },
      ['.']
    )

    // 임시 파일 정리는 별도 프로세스에서 처리
  }

  // 해시 계산
  private calculateHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex')
  }

  // 미디어 타입 추론
  private getMediaType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    
    switch (ext) {
      case 'wasm': return 'application/wasm'
      case 'js': return 'application/javascript'
      case 'json': return 'application/json'
      case 'html': return 'text/html'
      case 'css': return 'text/css'
      default: return 'application/octet-stream'
    }
  }

  // 메모리 크기 파싱
  private parseMemorySize(size: string): number {
    const match = size.match(/^(\d+)([kmgt]?b?)$/i)
    if (!match) throw new Error(`Invalid memory size: ${size}`)
    
    const value = parseInt(match[1])
    const unit = match[2].toLowerCase()
    
    switch (unit) {
      case 'kb': return value * 1024
      case 'mb': return value * 1024 * 1024
      case 'gb': return value * 1024 * 1024 * 1024
      case 'tb': return value * 1024 * 1024 * 1024 * 1024
      default: return value
    }
  }
} 