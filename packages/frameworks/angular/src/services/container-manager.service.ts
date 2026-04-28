import { Injectable } from '@angular/core'
import { ContainerManager, type ContainerManagerConfig } from '@gaesup-state/core'

@Injectable({ providedIn: 'root' })
export class ContainerManagerService {
  private manager = new ContainerManager()

  configure(config: ContainerManagerConfig = {}) {
    this.manager.cleanup().catch(console.error)
    this.manager = new ContainerManager(config)
  }

  async getManager(): Promise<ContainerManager> {
    return this.manager
  }
}
