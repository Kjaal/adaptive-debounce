<script setup lang="ts">
defineOptions({ name: 'VerificationOtherPage' })

const _recordCount = useState('record-count', () => 0)
</script>

<template>
  <main>
    <h1>Observer removed</h1>
    <output data-testid="record-count">{{ _recordCount }}</output>
    <label>After unmount <input id="after-unmount" type="text" /></label>
    <NuxtLink to="/">Return</NuxtLink>
  </main>
</template>
