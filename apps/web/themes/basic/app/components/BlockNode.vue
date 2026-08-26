<script setup lang="ts">
import { useBlockRegistry, type ComposedBlock } from '~/composables/useBlockRegistry';

// Basic theme's copy of the block-node renderer. Identical logic to the default
// theme's BlockNode; it exists solely so its `~/composables/useBlockRegistry`
// import resolves to THIS layer's registry (default renderers + neutral chrome).
// Because it overrides the default BlockNode by component name, every rendered
// block — including the header/footer parts mounted by the layout — routes
// through the basic registry.
const props = defineProps<{ block: ComposedBlock }>();

const registry = useBlockRegistry();
const component = computed(() => registry[props.block.key] ?? null);
const childBlocks = computed<ComposedBlock[]>(() => props.block.children ?? []);

if (import.meta.dev) {
  watchEffect(() => {
    if (!component.value && !props.block.error) {
      console.warn(
        `[blocks] no Vue component registered for block "${props.block.key}". ` +
          'Add it to apps/web/themes/basic/app/composables/useBlockRegistry.ts.',
      );
    }
  });
}
</script>

<template>
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
