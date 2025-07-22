import { AngularSidebarComponent } from './AngularSidebar.component';

export function mountAngularSidebar(elementId: string) {
  const element = document.getElementById(elementId);
  if (element) {
    new AngularSidebarComponent(element);
  }
} 