<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div
    data-testid="dag-node-type-legend"
    class="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-4 rounded-xl border border-[var(--atms-border)] bg-[var(--atms-panel)] px-4 py-2.5 shadow-[var(--atms-shadow-floating)] backdrop-blur-xl"
    :aria-label="t('dag.nodeTypes.legend')"
  >
    <span class="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--atms-text-4)]">
      {{ t('dag.nodeTypes.execution') }}
    </span>
    <span class="flex items-center gap-1.5 text-[10px] text-[var(--atms-text-2)]">
      <span class="legend-worker" />
      {{ t('dag.nodeTypes.worker') }}
    </span>
    <span class="flex items-center gap-1.5 text-[10px] text-[var(--atms-text-2)]">
      <span class="legend-gate" />
      {{ t('dag.nodeTypes.gate') }}
    </span>
    <span class="flex items-center gap-1.5 text-[10px] text-[var(--atms-text-2)]">
      <span class="legend-quorum" />
      {{ t('dag.nodeTypes.joinQuorum') }}
    </span>
    <span class="flex items-center gap-1.5 text-[10px] text-[var(--atms-text-2)]">
      <span class="legend-control" />
      {{ t('dag.nodeTypes.control') }}
    </span>
  </div>
</template>

<style scoped>
.legend-worker,
.legend-gate,
.legend-quorum,
.legend-control {
  display: inline-block;
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border: 1.5px solid var(--atms-accent);
  background: var(--atms-surface-2);
}

.legend-worker {
  border-radius: 999px;
  background: var(--atms-accent-soft);
}

.legend-gate {
  width: 11px;
  height: 11px;
  transform: rotate(45deg);
  border-color: var(--atms-warning);
}

.legend-quorum {
  border-color: var(--atms-speaking);
  clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%);
}

.legend-control {
  width: 17px;
  border-color: var(--atms-success);
  border-radius: 4px;
}
</style>
