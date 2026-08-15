import { useEffect, useState } from 'react'
import type { ContainerEvent, ContainerEventType } from 'gaesup-state'
import type { UseContainerEventsOptions } from '../types'
import { useContainerContext } from '../context/ContainerContext'

const ALL_EVENT_TYPES: ContainerEventType[] = [
  'container:created',
  'container:started',
  'container:stopped',
  'container:error'
]

export function useContainerEvents(options: UseContainerEventsOptions = {}) {
  const { eventTypes, bufferSize = 100 } = options
  const { manager } = useContainerContext()
  const [events, setEvents] = useState<ContainerEvent[]>([])

  useEffect(() => {
    if (!manager) {
      return undefined
    }

    const types = eventTypes?.length ? eventTypes : ALL_EVENT_TYPES
    const unsubscribers = types.map((eventType) =>
      manager.on(eventType, (event: ContainerEvent) => {
        setEvents((current) => [...current, event].slice(-bufferSize))
      })
    )

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [bufferSize, eventTypes, manager])

  return events
}
