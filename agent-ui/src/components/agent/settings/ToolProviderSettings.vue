<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Box, Loader2, RefreshCw } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ToolProviderCatalog, ToolProviderDescriptor } from 'atms-protocol'
import { getToolProviderCatalog } from '@/api/services/tool-providers-api'

const { t } = useI18n()
const catalog = ref<ToolProviderCatalog | null>(null)
const loading = ref(false)
const error = ref('')

function providerConnected(provider: ToolProviderDescriptor): boolean {
  return provider.bindings.some((binding) => (
    binding.runtime_state === 'available' || binding.runtime_state === 'connected'
  ))
}

function runtimeLabel(provider: ToolProviderDescriptor): string {
  const states = new Set(provider.bindings.map((binding) => binding.runtime_state))
  if (states.has('connected')) return t('settings.toolProviders.runtime.connected')
  if (states.has('available')) return t('settings.toolProviders.runtime.available')
  if (states.has('unavailable')) return t('settings.toolProviders.runtime.unavailable')
  return t('settings.toolProviders.runtime.disconnected')
}

function readableError(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return String(reason)
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    catalog.value = await getToolProviderCatalog()
  } catch (reason) {
    error.value = readableError(reason)
  } finally {
    loading.value = false
  }
}

onMounted(() => void refresh())
</script>

<template>
  <section data-testid="agent-settings-section-tool-providers" class="mt-8 space-y-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-[var(--atms-text-1)]">
          {{ t('settings.toolProviders.title') }}
        </h2>
        <p class="mt-1 max-w-3xl text-sm leading-6 text-[var(--atms-text-3)]">
          {{ t('settings.toolProviders.description') }}
        </p>
      </div>
      <button
        type="button"
        class="flex h-10 flex-shrink-0 items-center gap-2 rounded-full border border-[var(--atms-border)] px-3 text-sm text-[var(--atms-text-1)] hover:bg-[var(--atms-surface-2)] disabled:opacity-60"
        :disabled="loading"
        data-testid="tool-providers-refresh"
        @click="refresh"
      >
        <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" />
        {{ t('settings.actions.refresh') }}
      </button>
    </div>

    <p
      v-if="error"
      class="rounded-xl border border-[var(--atms-danger-border)] bg-[var(--atms-danger-soft)] p-3 text-sm text-[var(--atms-danger)]"
      data-testid="tool-providers-error"
    >
      {{ t('settings.toolProviders.error', { message: error }) }}
    </p>

    <div class="grid gap-3 lg:grid-cols-2">
      <article
        v-for="provider in catalog?.providers ?? []"
        :key="provider.id"
        class="rounded-2xl border border-[var(--atms-settings-divider)] bg-[var(--atms-settings-card)] p-5"
        :data-testid="`tool-provider-${provider.id}`"
      >
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--atms-border)] bg-[var(--atms-surface-1)] text-[var(--atms-accent)]">
            <Box class="h-5 w-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-[var(--atms-text-1)]">{{ provider.name }}</h3>
              <span class="rounded-full border border-[var(--atms-border)] px-2 py-0.5 text-[10px] text-[var(--atms-text-3)]">
                {{ provider.configuration_state === 'built_in'
                  ? t('settings.toolProviders.configuration.builtIn')
                  : t('settings.toolProviders.configuration.experimental') }}
              </span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px]"
                :class="providerConnected(provider)
                  ? 'border-[var(--atms-success-border)] bg-[var(--atms-success-soft)] text-[var(--atms-success)]'
                  : 'border-[var(--atms-border)] text-[var(--atms-text-3)]'"
              >
                {{ runtimeLabel(provider) }}
              </span>
            </div>
            <p class="mt-1 text-sm leading-6 text-[var(--atms-text-3)]">{{ provider.description }}</p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2 text-xs text-[var(--atms-text-3)]">
          <span class="rounded-lg bg-[var(--atms-surface-1)] px-2 py-1">
            {{ t('settings.toolProviders.toolCount', { count: provider.tools.length }) }}
          </span>
          <span class="rounded-lg bg-[var(--atms-surface-1)] px-2 py-1">
            {{ provider.kind === 'webmcp' ? 'WebMCP' : t('settings.toolProviders.nativeTools') }}
          </span>
          <span class="rounded-lg bg-[var(--atms-surface-1)] px-2 py-1">
            {{ t('settings.toolProviders.readOnly') }}
          </span>
        </div>

        <details class="mt-4 border-t border-[var(--atms-border)] pt-3">
          <summary class="cursor-pointer text-xs font-medium text-[var(--atms-text-2)]">
            {{ t('settings.toolProviders.showTools') }}
          </summary>
          <ul class="mt-3 max-h-56 space-y-2 overflow-y-auto">
            <li v-for="tool in provider.tools" :key="tool.name" class="rounded-lg bg-[var(--atms-surface-1)] px-3 py-2">
              <code class="text-xs text-[var(--atms-text-1)]">{{ tool.name }}</code>
              <p class="mt-1 text-xs leading-5 text-[var(--atms-text-3)]">{{ tool.description }}</p>
            </li>
          </ul>
        </details>
      </article>
    </div>
  </section>
</template>
