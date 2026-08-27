import type { NuxtConfig } from '@nuxt/schema'

const config: NuxtConfig = {
  modules: ['@adaptive-debounce/nuxt'],
  adaptiveDebounce: {
    observe: true,
    persistence: false,
  },
}

export default config
