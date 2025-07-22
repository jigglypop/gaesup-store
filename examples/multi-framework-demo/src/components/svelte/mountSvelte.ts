import SvelteMain from './SvelteMain.svelte';

export function mountSvelteMain(elementId: string) {
  const element = document.getElementById(elementId);
  if (element) {
    new SvelteMain({
      target: element,
      props: {}
    });
  }
} 