export {
  createAngularAdapter,
  createFrameworkAdapter,
  createReactAdapter,
  createSvelteAdapter,
  createVueAdapter
} from './FrameworkAdapter'
export { createAdapterContract } from './AdapterContract'

export type {
  AdapterContainerInstance,
  AdapterContract,
  AdapterContractContainer,
  AdapterMountContext,
  AdapterSnapshot,
  FrameworkAdapter,
  ReactivitySystem,
  ReactiveValue,
  StateSubscription
} from './types'

export const VERSION = '1.0.0'
