import type { App } from 'vue'
import type { ContainerManagerConfig } from '@gaesup-state/core'
import { provideContainerManager } from '../composables/useContainerManager'

export const GaesupStatePlugin = {
  install(app: App, options: ContainerManagerConfig = {}) {
    const manager = provideContainerManager(options)
    app.provide('gaesupContainerManager', manager)
  }
}
