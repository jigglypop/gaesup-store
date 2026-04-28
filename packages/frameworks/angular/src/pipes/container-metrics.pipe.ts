import { Pipe, PipeTransform } from '@angular/core'

@Pipe({
  name: 'containerMetrics',
  standalone: true
})
export class ContainerMetricsPipe implements PipeTransform {
  transform<T>(value: T): T {
    return value
  }
}
