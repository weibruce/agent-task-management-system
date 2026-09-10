<script setup lang="ts">
/**
 * CapabilityToggle — 按钮式能力开关。
 * 按下选中（高亮），再按取消。替代原来的 checkbox。
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  capability: 'llm' | 'asr' | 'tts' | 'audio' | 'vision' | 'video'
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
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

const activeClasses = computed(() => {
  const map: Record<string, string> = {
    llm: 'border-[var(--atms-success-border)] bg-[var(--atms-success-soft)] text-[var(--atms-success)] shadow-[0_0_12px_var(--atms-success-soft)]',
    asr: 'border-[var(--atms-info-border)] bg-[var(--atms-info-soft)] text-[var(--atms-info)] shadow-[0_0_12px_var(--atms-info-soft)]',
    tts: 'border-[var(--atms-warning-border)] bg-[var(--atms-warning-soft)] text-[var(--atms-warning)] shadow-[0_0_12px_var(--atms-warning-soft)]',
    audio: 'border-[var(--atms-accent-border)] bg-[var(--atms-accent-soft)] text-[var(--atms-accent)] shadow-[0_0_12px_color-mix(in_srgb,var(--atms-accent)_20%,transparent)]',
    vision: 'border-[var(--atms-speaking-border)] bg-[var(--atms-speaking-soft)] text-[var(--atms-speaking)] shadow-[0_0_12px_var(--atms-speaking-soft)]',
    video: 'border-[var(--atms-info-border)] bg-[var(--atms-info-soft)] text-[var(--atms-info)] shadow-[0_0_12px_var(--atms-info-soft)]',
  }
  return map[props.capability] ?? 'border-[var(--atms-border-strong)] bg-[var(--atms-surface-2)] text-[var(--atms-text-1)]'
})

function toggle(): void {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    :class="cn(
      'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 select-none',
      modelValue
        ? activeClasses
        : 'border-[var(--atms-border)] bg-transparent text-[var(--atms-text-3)] hover:border-[var(--atms-border-strong)] hover:text-[var(--atms-text-2)]'
    )"
    @click="toggle"
  >
    {{ label }}
  </button>
</template>
