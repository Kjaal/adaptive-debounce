<script setup lang="ts">
const delayMs = useAdaptiveDelay()
const save = useAdaptiveDebouncedFn(async (value: string) => value)
void delayMs
void save
</script>

<template>
  <main>Current delay: {{ Math.round(delayMs) }} ms</main>
</template>
