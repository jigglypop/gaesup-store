import { useEffect, useState } from 'react'
import type { ContainerEvent } from 'gaesup-state'
import type { UseContainerEventsOptions } from '../types'
import { useContainerContext } from '../context/ContainerContext'

export function useContainerEvents(options: UseContainerEventsOptions = {}) {
  const { eventTypes, bufferSize = 100 } = options
  const { manager } = useContainerContext()
  const [events, setEvents] = useState<ContainerEvent[]>([])

  useEffect(() => {
    if (!manager) {
      return undefined
    }

    const types = eventTypes?.length ? eventTypes : ['*']
    const unsubscribers = types.map((eventType) =>
      manager.events.on(String(eventType), (event: ContainerEvent) => {
        setEvents((current) => [...current, event].slice(-bufferSize))
      })
    )

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [bufferSize, eventTypes, manager])

  return events
}
