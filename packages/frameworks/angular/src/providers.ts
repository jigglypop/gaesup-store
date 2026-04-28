import { InjectionToken, Provider } from '@angular/core'
import type { ContainerManagerConfig } from 'gaesup-state'
import { ContainerManagerService } from './services/container-manager.service'

export const GAESUP_STATE_CONFIG = new InjectionToken<ContainerManagerConfig>('GAESUP_STATE_CONFIG')

export function provideContainerManager(config: ContainerManagerConfig = {}): Provider[] {
  return [
    { provide: GAESUP_STATE_CONFIG, useValue: config },
    ContainerManagerService
  ]
}

export function provideGaesupState(config: ContainerManagerConfig = {}): Provider[] {
  return provideContainerManager(config)
}
