<script setup lang="ts">
import { createAdaptiveDelay, type AdaptiveDelay } from 'adaptive-debounce'
import { observeTyping } from 'adaptive-debounce/browser'
import { onMounted, onUnmounted, shallowRef } from 'vue'

defineOptions({ name: 'VerificationIndexPage' })

const status = shallowRef('server-ready')
const recordCount = useState('record-count', () => 0)
const delay = createAdaptiveDelay()
const observedDelay: AdaptiveDelay = {
  ...delay,
  record() {
    recordCount.value += 1
    delay.record()
  },
}
let stopObserving: (() => void) | undefined

onMounted(() => {
  stopObserving = observeTyping(observedDelay)
  status.value = 'client-observing'
})

onUnmounted(() => {
  stopObserving?.()
  stopObserving = undefined
})
</script>

<template>
  <main>
    <h1>Adaptive debounce verification</h1>
    <p data-testid="status">{{ status }}</p>
    <output data-testid="record-count">{{ recordCount }}</output>

    <label>Text <input id="text-input" type="text" /></label>
    <label>Textarea <textarea id="textarea-input" /></label>
    <div id="editable-input" contenteditable="true" role="textbox" aria-label="Editable"></div>

    <label>Password <input id="password-input" type="password" /></label>
    <label>Payment <input id="payment-input" type="text" autocomplete="cc-number" /></label>
    <label>One-time code <input id="otp-input" type="text" autocomplete="one-time-code" /></label>
    <div data-adaptive-debounce-ignore>
      <label>Ignored <input id="ignored-input" type="text" /></label>
    </div>

    <NuxtLink to="/other">Leave observer</NuxtLink>
  </main>
</template>
