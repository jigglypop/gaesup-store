/**
 * 도커 연동 유틸리티
 * WASM 컨테이너를 도커로 배포하고 관리하는 기능
 */

// Note: utilities are placeholders; avoid unused imports to satisfy strict TS

export interface DockerContainerConfig {
  image: string;
  runtime: string;
  environment: Record<string, string>;
  labels: Record<string, string>;
  memory?: string;
  cpus?: string;
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  networks?: string[];
  ports?: string[];
}

export interface DockerComposeService {
  image: string;
  runtime: string;
  platform: string;
  environment: Record<string, string>;
  labels: Record<string, string>;
  networks: string[];
  restart: string;
  ports?: string[];
  volumes?: string[];
  depends_on?: string[];
}

export class DockerUtils {
  private static readonly DEFAULT_NETWORK = 'gaesup-network';
  private static readonly DEFAULT_REGISTRY = 'gaesup';

  /**
   * WASM 컨테이너를 도커 이미지로 빌드
   */
  static async buildWasmImage(
    containerName: string,
    wasmPath: string,
    version: string = 'latest'
  ): Promise<string> {
    const imageName = `${this.DEFAULT_REGISTRY}/${containerName}:${version}`;
    
    const dockerfile = this.generateDockerfile(wasmPath);
    
    try {
      // 도커 빌드 명령 실행
      const buildCommand = [
        'docker', 'build',
        '--platform', 'wasi/wasm',
        '--tag', imageName,
        '--file', '-',  // stdin에서 Dockerfile 읽기
        '.'
      ];

      await this.executeCommand(buildCommand, dockerfile);
      
      console.log(`✅ Built WASM image: ${imageName}`);
      return imageName;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to build WASM image: ${message}`);
    }
  }

  /**
   * 도커 컨테이너 생성 및 실행
   */
  static async runWasmContainer(
    imageName: string,
    config: DockerContainerConfig
  ): Promise<string> {
    try {
      const runCommand = this.buildRunCommand(imageName, config);
      const output = await this.executeCommand(runCommand);
      
      const containerId = output.trim();
      console.log(`🐳 Started Docker container: ${containerId}`);
      
      return containerId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to run WASM container: ${message}`);
    }
  }

  /**
   * 컨테이너 중지
   */
  static async stopContainer(containerId: string): Promise<void> {
    try {
      await this.executeCommand(['docker', 'stop', containerId]);
      console.log(`🛑 Stopped container: ${containerId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to stop container: ${message}`);
    }
  }

  /**
   * 컨테이너 재시작
   */
  static async restartContainer(containerId: string): Promise<void> {
    try {
      await this.executeCommand(['docker', 'restart', containerId]);
      console.log(`🔄 Restarted container: ${containerId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to restart container: ${message}`);
    }
  }

  /**
   * 컨테이너 제거
   */
  static async removeContainer(containerId: string, force: boolean = false): Promise<void> {
    try {
      const command = ['docker', 'rm'];
      if (force) command.push('--force');
      command.push(containerId);
      
      await this.executeCommand(command);
      console.log(`🗑️ Removed container: ${containerId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to remove container: ${message}`);
    }
  }

  /**
   * 컨테이너 목록 조회
   */
  static async listContainers(filter?: string): Promise<DockerContainer[]> {
    try {
      const command = ['docker', 'ps', '--format', 'json'];
      if (filter) {
        command.push('--filter', filter);
      }
      
      const output = await this.executeCommand(command);
      const lines = output.trim().split('\n').filter(line => line);
      
      return lines.map(line => JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to list containers: ${message}`);
    }
  }

  /**
   * 도커 컴포즈 파일 생성
   */
  static generateDockerCompose(
    services: Record<string, DockerComposeService>,
    options?: {
      version?: string;
      networks?: Record<string, any>;
      volumes?: Record<string, any>;
    }
  ): string {
    const compose = {
      version: options?.version || '3.8',
      
      services,
      
      networks: {
        [this.DEFAULT_NETWORK]: {
          driver: 'bridge',
          ipam: {
            config: [{ subnet: '172.20.0.0/16' }]
          }
        },
        ...options?.networks
      },

      volumes: options?.volumes || {}
    };

    return this.yamlStringify(compose);
  }

  /**
   * 도커 컴포즈 실행
   */
  static async deployCompose(
    composeContent: string,
    projectName: string = 'gaesup'
  ): Promise<void> {
    try {
      // 임시 파일에 컴포즈 내용 저장
      const tempFile = `/tmp/docker-compose-${Date.now()}.yml`;
      await this.writeFile(tempFile, composeContent);
      
      const command = [
        'docker-compose',
        '--project-name', projectName,
        '--file', tempFile,
        'up', '--detach'
      ];
      
      await this.executeCommand(command);
      console.log(`🚀 Deployed compose project: ${projectName}`);
      
      // 임시 파일 정리
      await this.deleteFile(tempFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to deploy compose: ${message}`);
    }
  }

  /**
   * 컨테이너 로그 조회
   */
  static async getLogs(
    containerId: string,
    options?: { tail?: number; follow?: boolean }
  ): Promise<string> {
    try {
      const command = ['docker', 'logs'];
      
      if (options?.tail) {
        command.push('--tail', options.tail.toString());
      }
      
      if (options?.follow) {
        command.push('--follow');
      }
      
      command.push(containerId);
      
      return await this.executeCommand(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to get logs: ${message}`);
    }
  }

  /**
   * 컨테이너 리소스 사용량 조회
   */
  static async getStats(containerId: string): Promise<DockerStats> {
    try {
      const command = [
        'docker', 'stats',
        '--format', 'json',
        '--no-stream',
        containerId
      ];
      
      const output = await this.executeCommand(command);
      return JSON.parse(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to get stats: ${message}`);
    }
  }

  // Private helper methods
  
  private static generateDockerfile(wasmPath: string): string {
    return `# WASM 컨테이너 Dockerfile
FROM scratch

# WASM 바이너리 복사
COPY ${wasmPath} /app.wasm

# 기본 실행 명령
CMD ["/app.wasm"]

# 메타데이터
LABEL org.opencontainers.image.title="Gaesup WASM Container"
LABEL org.opencontainers.image.description="WASM container managed by Gaesup-State"
LABEL gaesup.wasm.runtime="true"
`;
  }

  private static buildRunCommand(
    imageName: string,
    config: DockerContainerConfig
  ): string[] {
    const command = ['docker', 'run', '--detach'];
    
    // 런타임 설정
    if (config.runtime) {
      command.push('--runtime', config.runtime);
    }
    
    // 메모리 제한
    if (config.memory) {
      command.push('--memory', config.memory);
    }
    
    // CPU 제한
    if (config.cpus) {
      command.push('--cpus', config.cpus);
    }
    
    // 재시작 정책
    if (config.restart) {
      command.push('--restart', config.restart);
    }
    
    // 환경 변수
    Object.entries(config.environment).forEach(([key, value]) => {
      command.push('--env', `${key}=${value}`);
    });
    
    // 라벨
    Object.entries(config.labels).forEach(([key, value]) => {
      command.push('--label', `${key}=${value}`);
    });
    
    // 네트워크
    if (config.networks) {
      config.networks.forEach(network => {
        command.push('--network', network);
      });
    }
    
    // 포트
    if (config.ports) {
      config.ports.forEach(port => {
        command.push('--publish', port);
      });
    }
    
    command.push(imageName);
    return command;
  }

  private static async executeCommand(
    command: string[],
    stdin?: string
  ): Promise<string> {
    // 실제 구현에서는 child_process 사용
    // 현재는 Mock 구현
    console.log(`Executing: ${command.join(' ')}`);
    
    if (stdin) {
      console.log(`With stdin: ${stdin.substring(0, 100)}...`);
    }
    
    // Mock response
    if (command.includes('run')) {
      return 'container_id_' + Math.random().toString(36).substring(7);
    }
    
    return 'command executed successfully';
  }

  private static async writeFile(path: string, content: string): Promise<void> {
    // Mock 구현
    console.log(`Writing file: ${path}`);
  }

  private static async deleteFile(path: string): Promise<void> {
    // Mock 구현
    console.log(`Deleting file: ${path}`);
  }

  private static yamlStringify(obj: any): string {
    // 간단한 YAML 변환 (실제로는 yaml 라이브러리 사용)
    return JSON.stringify(obj, null, 2)
      .replace(/"/g, '')
      .replace(/,$/gm, '')
      .replace(/^\{$/gm, '')
      .replace(/^\}$/gm, '');
  }
}

// 타입 정의
export interface DockerContainer {
  ID: string;
  Image: string;
  Command: string;
  CreatedAt: string;
  Status: string;
  Ports: string;
  Names: string;
  Labels: string;
}

export interface DockerStats {
  Container: string;
  Name: string;
  ID: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  NetIO: string;
  BlockIO: string;
  PIDs: string;
} 