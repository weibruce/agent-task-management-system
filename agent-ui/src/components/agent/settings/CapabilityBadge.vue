<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  capability: 'llm' | 'asr' | 'tts' | 'audio' | 'vision' | 'video'
  active?: boolean
}>()

const label = computed(() => {
  const map: Record<string, string> = {
    llm: 'LLM',
    asr: 'ASR',
    tts: 'TTS',
    audio: 'Audio',
    vision: 'Vision',
    video: 'Video',
  }
  return map[props.capability] ?? props.capability
})

const classes = computed(() => {
  if (!props.active) {
    return 'border-[var(--atms-border)] text-[var(--atms-text-3)] bg-transparent'
  }
  const map: Record<string, string> = {
    llm: 'border-[var(--atms-success-border)] bg-[var(--atms-success-soft)] text-[var(--atms-success)]',
    asr: 'border-[var(--atms-info-border)] bg-[var(--atms-info-soft)] text-[var(--atms-info)]',
    tts: 'border-orange-300/40 bg-orange-300/10 text-orange-100',
    audio: 'border-[var(--atms-accent-border)] bg-[var(--atms-accent-soft)] text-[var(--atms-accent)]',
    vision: 'border-[var(--atms-speaking-border)] bg-[var(--atms-speaking-soft)] text-[var(--atms-speaking)]',
    video: 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-100',
  }
  return map[props.capability] ?? 'border-[var(--atms-border)] bg-[var(--atms-surface-1)] text-[var(--atms-text-2)]'
})
</script>

<template>
  <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="classes">
    {{ label }}
  </span>
</template>
