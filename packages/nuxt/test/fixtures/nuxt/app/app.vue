<script setup lang="ts">
const delayMs = useAdaptiveDelay()
const save = useAdaptiveDebouncedFn(async (value: string) => value)
const nuxtApp = useNuxtApp()
const mounted = ref(false)
const mountedDelayMs = ref<number | null>(null)
const revision = 'initial'
onMounted(() => {
  mountedDelayMs.value = delayMs.value
  document.documentElement.dataset.frameworkMounted = 'true'
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
    <span data-testid="mounted-delay">{{ mountedDelayMs }}</span>
    <span data-testid="revision">{{ revision }}</span>
    <NuxtPage />
    <button @click="nuxtApp.vueApp.unmount()">Unmount app</button>
  </main>
</template>
