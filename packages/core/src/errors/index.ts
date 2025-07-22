export class ContainerError extends Error {
  readonly code: string
  readonly containerId?: string
  readonly details?: any
  
  constructor(message: string, code: string, details?: any) {
    super(message)
    this.name = 'ContainerError'
    this.code = code
    this.details = details
    
    // Error의 프로토타입 체인 유지
    Object.setPrototypeOf(this, ContainerError.prototype)
  }
}

export class ContainerNotFoundError extends ContainerError {
  constructor(containerId: string, details?: any) {
    super(
      `Container not found: ${containerId}`, 
      'CONTAINER_NOT_FOUND',
      details
    )
    this.name = 'ContainerNotFoundError'
    this.containerId = containerId
    Object.setPrototypeOf(this, ContainerNotFoundError.prototype)
  }
}

export class ContainerStartupError extends ContainerError {
  constructor(containerId: string, message: string, details?: any) {
    super(
      `Container startup failed: ${containerId} - ${message}`,
      'CONTAINER_STARTUP_FAILED',
      details
    )
    this.name = 'ContainerStartupError'
    this.containerId = containerId
    Object.setPrototypeOf(this, ContainerStartupError.prototype)
  }
}

export class ContainerMemoryError extends ContainerError {
  constructor(containerId: string, memoryUsed: number, memoryLimit: number) {
    super(
      `Container memory limit exceeded: ${containerId} (${memoryUsed}/${memoryLimit} bytes)`,
      'CONTAINER_MEMORY_LIMIT',
      { memoryUsed, memoryLimit }
    )
    this.name = 'ContainerMemoryError'
    this.containerId = containerId
    Object.setPrototypeOf(this, ContainerMemoryError.prototype)
  }
}

export class ContainerTimeoutError extends ContainerError {
  constructor(containerId: string, operation: string, timeoutMs: number) {
    super(
      `Container operation timeout: ${containerId} - ${operation} (${timeoutMs}ms)`,
      'CONTAINER_TIMEOUT',
      { operation, timeoutMs }
    )
    this.name = 'ContainerTimeoutError'
    this.containerId = containerId
    Object.setPrototypeOf(this, ContainerTimeoutError.prototype)
  }
}

export class ContainerSecurityError extends ContainerError {
  constructor(containerId: string, violation: string, details?: any) {
    super(
      `Container security violation: ${containerId} - ${violation}`,
      'CONTAINER_SECURITY_VIOLATION',
      { violation, ...details }
    )
    this.name = 'ContainerSecurityError'
    this.containerId = containerId
    Object.setPrototypeOf(this, ContainerSecurityError.prototype)
  }
}

export class RegistryError extends ContainerError {
  constructor(message: string, details?: any) {
    super(
      `Registry error: ${message}`,
      'REGISTRY_ERROR',
      details
    )
    this.name = 'RegistryError'
    Object.setPrototypeOf(this, RegistryError.prototype)
  }
}

export class CompilationError extends ContainerError {
  constructor(message: string, source?: string, details?: any) {
    super(
      `WASM compilation error: ${message}`,
      'COMPILATION_ERROR',
      { source, ...details }
    )
    this.name = 'CompilationError'
    Object.setPrototypeOf(this, CompilationError.prototype)
  }
} 