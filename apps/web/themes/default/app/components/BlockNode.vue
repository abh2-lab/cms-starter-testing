<script setup lang="ts">
import { useBlockRegistry, type ComposedBlock } from '~/composables/useBlockRegistry';

// Renders ONE composed block: resolve its Vue component from the registry, pass
// the API-resolved fields/options/data, and expose any children as the default
// slot (a nested <BlockTree>). Container/box components render `<slot />` to
// place their children; field/standalone components ignore it. A block whose key
// isn't in the registry is skipped (dev warning); a block the API flagged with
// an error renders a degraded placeholder so editors notice.
const props = defineProps<{ block: ComposedBlock }>();

const registry = useBlockRegistry();
const component = computed(() => registry[props.block.key] ?? null);
const childBlocks = computed<ComposedBlock[]>(() => props.block.children ?? []);

if (import.meta.dev) {
  watchEffect(() => {
    if (!component.value && !props.block.error) {
      console.warn(
        `[blocks] no Vue component registered for block "${props.block.key}". ` +
          'Add it to apps/web/themes/default/app/composables/useBlockRegistry.ts.',
      );
    }
  });
}
</script>

<template>
  <!-- data-block-id lands on the block component's root element (fallthrough
       attr) — v2.1's click-to-select maps a rendered node back to its
       composed instance through it. Rendering it costs nothing today. -->
  <component
    :is="component"
    v-if="component && !block.error"
    :fields="block.fields"
    :options="block.options"
    :data="block.data"
    :data-block-id="block.id"
  >
    <BlockTree v-if="childBlocks.length" :blocks="childBlocks" />
  </component>

  <div v-else-if="block.error === 'unknown_block'" class="block-error">
    <p>
      <strong>Block unavailable:</strong>
      <code>{{ block.key }}</code> is referenced here but not registered in the
      renderer. Re-publish after the block ships or remove it in the editor.
    </p>
  </div>
  <div v-else-if="block.error === 'load_failed'" class="block-error">
    <p>
      <strong>Block failed to load:</strong>
      <code>{{ block.key }}</code>. Check the API logs.
    </p>
  </div>
  <div v-else-if="block.error === 'max_depth'" class="block-error">
    <p>
      <strong>Block nesting too deep:</strong>
      <code>{{ block.key }}</code> exceeded the maximum depth and was skipped.
    </p>
  </div>
  <div v-else-if="block.error === 'budget_exceeded'" class="block-error">
    <p>
      <strong>Too many blocks:</strong> this page exceeded the block budget;
      <code>{{ block.key }}</code> was skipped.
    </p>
  </div>
</template>

<style scoped>
.block-error {
  max-width: 64rem;
  margin: 1rem auto;
  padding: 1rem 1.25rem;
  border: 1px solid rgba(220, 38, 38, 0.3);
  background: rgba(220, 38, 38, 0.05);
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.875rem;
}
.block-error code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
