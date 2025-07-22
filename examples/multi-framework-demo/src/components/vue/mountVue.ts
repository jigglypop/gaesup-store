import { createApp } from 'vue';
import VueFooter from './VueFooter.vue';

export function mountVueFooter(elementId: string) {
  const element = document.getElementById(elementId);
  if (element) {
    const app = createApp(VueFooter);
    app.mount(element);
  }
} 