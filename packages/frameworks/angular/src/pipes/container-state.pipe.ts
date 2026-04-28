import { Pipe, PipeTransform } from '@angular/core'

@Pipe({
  name: 'containerState',
  standalone: true
})
export class ContainerStatePipe implements PipeTransform {
  transform<T>(value: T): T {
    return value
  }
}
