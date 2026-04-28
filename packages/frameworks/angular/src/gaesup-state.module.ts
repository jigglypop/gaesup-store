import { NgModule } from '@angular/core'
import { ContainerDirective } from './directives/container.directive'
import { ContainerStatePipe } from './pipes/container-state.pipe'
import { ContainerMetricsPipe } from './pipes/container-metrics.pipe'

@NgModule({
  imports: [ContainerDirective, ContainerStatePipe, ContainerMetricsPipe],
  exports: [ContainerDirective, ContainerStatePipe, ContainerMetricsPipe]
})
export class GaesupStateModule {}
