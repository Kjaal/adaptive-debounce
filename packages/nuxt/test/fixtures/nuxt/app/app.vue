<script setup lang="ts">
const delayMs = useAdaptiveDelay()
const save = useAdaptiveDebouncedFn(async (value: string) => value)
const nuxtApp = useNuxtApp()
const mounted = ref(false)
const revision = 'initial'
onMounted(() => {
  mounted.value = true
})
void save
void delayMs
void nuxtApp
void revision
</script>

<template>
  <main>
    <span data-testid="delay">{{ Math.round(delayMs) }}</span>
    <span data-testid="mounted">{{ mounted }}</span>
    <span data-testid="revision">{{ revision }}</span>
    <NuxtPage />
    <button @click="nuxtApp.vueApp.unmount()">Unmount app</button>
  </main>
</template>
