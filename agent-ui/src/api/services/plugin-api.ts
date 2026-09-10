import { http, type ApiResponse } from '@/api/clients/http-client'

export interface AtmsPluginSummaryV1 {
  id: string
  name: string
  version: string
  package_digest: string
  manifest_digest: string
  source: string
  enabled: boolean
  locked: boolean
  activation_revision: number
  capabilities: string[]
  skills: string[]
  tools: string[]
  kinds: string[]
  renderers: string[]
  actions: string[]
}

export interface AtmsPluginRegistrySummaryV1 {
  registry_revision: number
  registry_fingerprint: string
  plugins: AtmsPluginSummaryV1[]
}

export function listAtmsPlugins(): Promise<ApiResponse<AtmsPluginRegistrySummaryV1>> {
  return http.get<AtmsPluginRegistrySummaryV1>('/api/plugins')
}

export function setAtmsPluginEnabled(
  pluginId: string,
  enabled: boolean,
  expectedRevision: number,
  expectedActiveVersion: string,
): Promise<ApiResponse<{ activation: Record<string, unknown>; registry: AtmsPluginRegistrySummaryV1 }>> {
  return http.put<{ activation: Record<string, unknown>; registry: AtmsPluginRegistrySummaryV1 }>(
    `/api/plugins/${encodeURIComponent(pluginId)}/enabled`,
    {
      enabled,
      expected_revision: expectedRevision,
      expected_active_version: expectedActiveVersion,
    },
  )
}
