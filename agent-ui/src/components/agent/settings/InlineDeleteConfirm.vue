<script setup lang="ts">
import { Loader2, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineProps<{
  message: string
  loading?: boolean
  testId: string
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    :data-testid="testId"
    class="rounded-lg border border-[var(--atms-danger-border)] bg-[var(--atms-panel)] p-3 backdrop-blur-md"
    :style="{ boxShadow: 'var(--atms-shadow-floating)' }"
    @click.stop
  >
    <div class="flex items-start gap-2.5">
      <span class="mt-0.5 rounded-full bg-[var(--atms-danger-soft)] p-1.5 text-[var(--atms-danger)]">
        <Trash2 class="h-3.5 w-3.5" />
      </span>
      <p class="min-w-0 flex-1 text-xs leading-relaxed text-[var(--atms-text-2)]">{{ message }}</p>
    </div>
    <div class="mt-3 flex gap-2">
      <button
        type="button"
        :data-testid="`${testId}-confirm`"
        class="flex-1 rounded-md border border-[var(--atms-danger-border)] bg-[var(--atms-danger-soft)] px-3 py-1.5 text-xs font-medium text-[var(--atms-danger)] transition hover:brightness-110 disabled:opacity-45"
        :disabled="loading"
        @click="$emit('confirm')"
      >
        <Loader2 v-if="loading" class="mr-1 inline h-3 w-3 animate-spin" />
        {{ t('settings.actions.delete') }}
      </button>
      <button
        type="button"
        :data-testid="`${testId}-cancel`"
        class="flex-1 rounded-md border border-[var(--atms-border)] bg-[var(--atms-surface-1)] px-3 py-1.5 text-xs text-[var(--atms-text-2)] transition hover:bg-[var(--atms-surface-2)]"
        :disabled="loading"
        @click="$emit('cancel')"
      >
        {{ t('settings.actions.cancel') }}
      </button>
    </div>
  </div>
</template>
