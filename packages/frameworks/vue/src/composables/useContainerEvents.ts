import { onUnmounted, ref } from 'vue'
import type { ContainerEvent } from '@gaesup-state/core'
import { useContainerManager } from './useContainerManager'

export function useContainerEvents(eventType = '*', bufferSize = 100) {
  const manager = useContainerManager()
  const events = ref<ContainerEvent[]>([])

  const unsubscribe = manager.value?.events.on(eventType, (event: ContainerEvent) => {
    events.value = [...events.value, event].slice(-bufferSize)
  })

  onUnmounted(() => unsubscribe?.())

  return { events }
}
