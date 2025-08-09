#!/usr/bin/env node

/**
 * Gaesup-State CLI 도구 (간단 JavaScript 버전)
 * WASM 컨테이너를 명령어로 관리
 */

// Mock 컨테이너 관리자
class MockContainerManager {
  constructor() {
    this.containers = new Map();
  }
  
  async run(name, config) {
    const id = `${name}-${Date.now()}`;
    const container = {
      id,
      name,
      status: 'running',
      config,
      startTime: Date.now(),
      metrics: {
        cpuUsage: 0,
        memoryUsage: { used: 0, limit: config.maxMemory || 100 * 1024 * 1024 },
        uptime: 0,
        callCount: 0,
        errorCount: 0
      }
    };
    
    this.containers.set(id, container);
    return container;
  }
  
  list() {
    return Array.from(this.containers.values());
  }
  
  get(id) {
    return this.containers.get(id);
  }
  
  async stop(id) {
    const container = this.containers.get(id);
    if (container) {
      container.status = 'stopped';
    }
  }
  
  async cleanup() {
    this.containers.clear();
  }
}

class SimpleGaesupCLI {
  constructor() {
    this.containerManager = new MockContainerManager();
    this.commands = new Map();
    this.setupCommands();
  }

  setupCommands() {
    this.addCommand({
      name: 'run',
      description: '새 WASM 컨테이너 실행',
      action: this.runContainer.bind(this)
    });

    this.addCommand({
      name: 'list',
      description: '실행 중인 컨테이너 목록 조회',
      action: this.listContainers.bind(this)
    });

    this.addCommand({
      name: 'stop',
      description: '컨테이너 중지',
      action: this.stopContainer.bind(this)
    });

    this.addCommand({
      name: 'status',
      description: '컨테이너 상태 조회',
      action: this.getStatus.bind(this)
    });

    this.addCommand({
      name: 'cleanup',
      description: '모든 컨테이너 정리',
      action: this.cleanup.bind(this)
    });
  }

  addCommand(command) {
    this.commands.set(command.name, command);
  }

  async run(args = process.argv.slice(2)) {
    if (args.length === 0 || args[0] === 'help') {
      this.showHelp();
      return;
    }

    const commandName = args[0];
    const command = this.commands.get(commandName);

    if (!command) {
      console.error(`❌ Unknown command: ${commandName}`);
      this.showHelp();
      process.exit(1);
    }

    try {
      const parsedArgs = this.parseArgs(args.slice(1));
      await command.action(parsedArgs);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  }

  parseArgs(args) {
    const parsed = {};
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        
        if (key === 'debug') {
          parsed[key] = true;
        } else {
          const value = args[++i];
          if (!value) {
            throw new Error(`Missing value for option: ${arg}`);
          }
          
          if (key === 'memory') {
            parsed[key] = Number(value);
          } else {
            parsed[key] = value;
          }
        }
      }
    }

    return parsed;
  }

  showHelp() {
    const commands = Array.from(this.commands.values())
      .map(cmd => `  ${cmd.name.padEnd(12)} ${cmd.description}`)
      .join('\n');

    console.log(`
🚀 Gaesup-State CLI (간단 버전)

사용법: gaesup <command> [options]

Commands:
${commands}

Examples:
  gaesup run --name todo-app --runtime wasmtime --memory 50
  gaesup list
  gaesup stop --id container-id
  gaesup status --id container-id
  gaesup cleanup
`);
  }

  // Command implementations

  async runContainer(args) {
    const name = args.name || 'my-app';
    const runtime = args.runtime || 'wasmtime';
    const memory = args.memory || 100;
    
    console.log(`🚀 Starting container: ${name}`);

    const config = {
      runtime,
      maxMemory: memory * 1024 * 1024, // MB to bytes
      debug: args.debug || false
    };

    const container = await this.containerManager.run(name, config);
    
    console.log(`✅ Container started successfully!`);
    console.log(`   ID: ${container.id}`);
    console.log(`   Runtime: ${runtime}`);
    console.log(`   Memory: ${memory}MB`);
  }

  async listContainers() {
    console.log(`📋 Container List:\n`);

    const containers = this.containerManager.list();
    
    if (containers.length === 0) {
      console.log('No running containers.');
      return;
    }

    console.log('ID'.padEnd(25) + 'NAME'.padEnd(15) + 'STATUS'.padEnd(12) + 'UPTIME');
    console.log('-'.repeat(65));

    containers.forEach(container => {
      const uptime = Date.now() - container.startTime;
      console.log(
        container.id.padEnd(25) +
        container.name.padEnd(15) +
        container.status.padEnd(12) +
        this.formatUptime(uptime)
      );
    });
  }

  async stopContainer(args) {
    if (!args.id) {
      throw new Error('Container ID is required (--id)');
    }
    
    console.log(`🛑 Stopping container: ${args.id}`);
    await this.containerManager.stop(args.id);
    console.log(`✅ Container stopped: ${args.id}`);
  }

  async getStatus(args) {
    if (!args.id) {
      throw new Error('Container ID is required (--id)');
    }
    
    const container = this.containerManager.get(args.id);
    
    if (!container) {
      throw new Error(`Container not found: ${args.id}`);
    }

    console.log(`📊 Container Status: ${args.id}\n`);
    console.log(`Name: ${container.name}`);
    console.log(`Status: ${container.status}`);
    console.log(`Runtime: ${container.config.runtime}`);
    console.log(`Memory Limit: ${this.formatBytes(container.config.maxMemory)}`);
    console.log(`Uptime: ${this.formatUptime(Date.now() - container.startTime)}`);
  }

  async cleanup() {
    console.log(`🧹 Cleaning up containers...`);
    await this.containerManager.cleanup();
    console.log(`✅ Cleanup completed`);
  }

  // Utility methods

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let value = bytes;
    
    while (value >= 1024 && i < sizes.length - 1) {
      value /= 1024;
      i++;
    }
    
    return `${value.toFixed(1)}${sizes[i]}`;
  }
}

// CLI 실행
if (require.main === module) {
  const cli = new SimpleGaesupCLI();
  cli.run().catch(error => {
    console.error('CLI Error:', error);
    process.exit(1);
  });
}

module.exports = { SimpleGaesupCLI }; 