<script lang="ts">
  import { gaesupStore } from '@gaesup-state/svelte';
  import {
    SHARED_STORE_ID,
    decrementCount,
    incrementCount,
    resetCount,
    type SharedState
  } from '../../stores/sharedStore';

  const store = gaesupStore<SharedState>(SHARED_STORE_ID, {
    count: 0,
    lastUpdated: null,
    framework: 'None',
    history: []
  });
</script>

<article class="counter-card" style="--accent: #ff8a3d">
  <div>
    <div class="framework-name">Svelte</div>
    <div class="card-title">Store subscriber</div>
    <p class="card-copy">Uses a Svelte store wrapper over the same Gaesup store.</p>
  </div>

  <div>
    <div class="count-value" data-counter="svelte">{$store.count}</div>
    <div class="last-update">Last writer: {$store.framework}</div>
    <div class="button-row">
      <button class="primary" data-action="svelte-inc" on:click={() => incrementCount('Svelte')}>+1</button>
      <button data-action="svelte-dec" on:click={() => decrementCount('Svelte')}>-1</button>
      <button data-action="svelte-reset" on:click={() => resetCount('Svelte')}>Reset</button>
    </div>
  </div>
</article>
