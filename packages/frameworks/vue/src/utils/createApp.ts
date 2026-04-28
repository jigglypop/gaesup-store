import { createApp, type Component } from 'vue'
import type { ContainerManagerConfig } from 'gaesup-state'
import { GaesupStatePlugin } from '../plugin/GaesupStatePlugin'

export function createGaesupApp(root: Component, config: ContainerManagerConfig = {}) {
  return createApp(root).use(GaesupStatePlugin, config)
}
