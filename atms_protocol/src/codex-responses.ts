/**
 * Shared Codex app-server contract for Atms-managed Responses providers.
 *
 * Codex app-server only speaks the Responses wire protocol. Provider-backed
 * runs are configured through process-local `-c` overrides so Atms never
 * writes decrypted credentials into the user's Codex config.
 * @version 0.1.0
 */

export const CODEX_RESPONSES_PROTOCOL = "responses_compatible" as const;
export const ATMS_CODEX_MODEL_PROVIDER_ID = "atms_responses" as const;
export const ATMS_CODEX_API_KEY_ENV = "ATMS_CODEX_API_KEY" as const;

const CODEX_PROVIDER_ISOLATION_FEATURES = [
  "apps",
  "plugins",
  "remote_plugin",
  "plugin_sharing",
  "skill_search",
  "skill_mcp_dependency_install",
  "multi_agent",
  "multi_agent_v2",
] as const;

export interface CodexResponsesProviderConfig {
  providerName?: string;
  baseUrl: string;
  apiKey?: string;
  /** Isolated Codex model catalog generated for the selected provider/model. */
  modelCatalogPath?: string;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Codex expects an API root and appends `/responses` itself. */
export function normalizeCodexResponsesBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/responses$/i, "");
}

export function codexResponsesAppServerArgs(
  input: CodexResponsesProviderConfig,
): string[] {
  const baseUrl = normalizeCodexResponsesBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Codex Responses provider base URL is required");
  const providerName = input.providerName?.trim() || "Atms Responses";
  const args = [
    "app-server",
    "-c",
    `model_providers.${ATMS_CODEX_MODEL_PROVIDER_ID}.name=${tomlString(providerName)}`,
    "-c",
    `model_providers.${ATMS_CODEX_MODEL_PROVIDER_ID}.base_url=${tomlString(baseUrl)}`,
    "-c",
    `model_providers.${ATMS_CODEX_MODEL_PROVIDER_ID}.env_key=${tomlString(ATMS_CODEX_API_KEY_ENV)}`,
    "-c",
    `model_providers.${ATMS_CODEX_MODEL_PROVIDER_ID}.wire_api="responses"`,
    "-c",
    `model_providers.${ATMS_CODEX_MODEL_PROVIDER_ID}.requires_openai_auth=false`,
    "-c",
    `model_provider=${tomlString(ATMS_CODEX_MODEL_PROVIDER_ID)}`,
    "-c",
    "skills.bundled.enabled=false",
    "-c",
    `shell_environment_policy.exclude=[${tomlString(ATMS_CODEX_API_KEY_ENV)}]`,
  ];
  const modelCatalogPath = input.modelCatalogPath?.trim();
  if (modelCatalogPath) {
    args.push("-c", `model_catalog_json=${tomlString(modelCatalogPath)}`);
  }
  for (const feature of CODEX_PROVIDER_ISOLATION_FEATURES) {
    args.push("-c", `features.${feature}=false`);
  }
  return args;
}

export function codexResponsesProviderEnvironment(
  input: CodexResponsesProviderConfig,
): Record<string, string> {
  const apiKey = input.apiKey?.trim();
  return apiKey ? { [ATMS_CODEX_API_KEY_ENV]: apiKey } : {};
}
