<template>
  <article class="counter-card" style="--accent: #42d392">
    <div>
      <div class="framework-name">Vue</div>
      <div class="card-title">Composable subscriber</div>
      <p class="card-copy">Uses the Vue composable and reacts to the shared state snapshot.</p>
    </div>

    <div>
      <div class="count-value" data-counter="vue">{{ state.count }}</div>
      <div class="last-update">Last writer: {{ state.framework }}</div>
      <div class="button-row">
        <button class="primary" data-action="vue-inc" @click="incrementCount('Vue')">+1</button>
        <button data-action="vue-dec" @click="decrementCount('Vue')">-1</button>
        <button data-action="vue-reset" @click="resetCount('Vue')">Reset</button>
      </div>
    </div>
  </article>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useGaesupState } from '@gaesup-state/vue';
import {
  SHARED_STORE_ID,
  decrementCount,
  incrementCount,
  resetCount,
  type SharedState
} from '../../stores/sharedStore';

export default defineComponent({
  name: 'VueFooter',
  setup() {
    const { state } = useGaesupState<SharedState>(SHARED_STORE_ID, {
      count: 0,
      lastUpdated: null,
      framework: 'None',
      history: []
    });

    return {
      state,
      incrementCount,
      decrementCount,
      resetCount
    };
  }
});
</script>
