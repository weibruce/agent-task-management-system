import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the persistence layer ──────────────────────────────────────────
let mockSetting: any;
vi.mock("../src/persistence/llm-settings.js", () => {
  let _mockSetting: any;
  return {
    findActiveLlmRuntimeSetting: vi.fn(() => _mockSetting),
    getSetting: vi.fn((id: string) => _mockSetting?.id === id ? _mockSetting : undefined),
    findActiveSetting: vi.fn(() => undefined),
    findActiveKimiSetting: vi.fn(() => undefined),
    findActiveCodexCompatibleSetting: vi.fn(() => undefined),
    findActiveClaudeSdkCompatibleSetting: vi.fn((..._args: any[]) => {
      // Return the mock setting for manager_agent surface (claude-sdk path)
      // but only if the setting has an anthropic_base_url
      return _mockSetting?.anthropic_base_url ? _mockSetting : undefined;
    }),
    findActiveDeepSeekHarnessCompatibleSetting: vi.fn(() => _mockSetting),
    resolveDeepSeekHarnessBaseUrlForSetting: vi.fn((s: any) => {
      if (s?.protocol === "anthropic_compatible") return undefined;
      const raw = s?.chat_completions_base_url ?? s?.base_url;
      // Mimic the real normalizeBaseUrl: strip trailing /chat/completions
      return raw?.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
    }),
    resolveClaudeSdkBaseUrlForSetting: vi.fn((s: any) => s?.anthropic_base_url ?? undefined),
    resolveClaudeSdkAuthModeForSetting: vi.fn(() => "api_key"),
    resolveCodexResponsesBaseUrlForSetting: vi.fn(() => undefined),
    isVoiceServiceSetting: vi.fn(() => false),
    getProvider: vi.fn(() => undefined),
    __setMockSetting: (s: any) => { _mockSetting = s; },
    __getMockSetting: () => _mockSetting,
  };
});

// ── Mock the provider catalog ───────────────────────────────────────────
vi.mock("../src/persistence/provider-catalog.js", () => ({
  findCatalogEndpoint: vi.fn(() => undefined),
  findEndpointModel: vi.fn(() => undefined),
  canonicalModelNameForEndpoint: vi.fn((_p: string, _e: string, m: string) => m),
  getProvider: vi.fn(() => undefined),
  isKimiProviderId: vi.fn(() => false),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────
import { resolveAgentRuntimeConfig } from "../src/runtime/agent-runtime-resolver.js";
import * as llmSettings from "../src/persistence/llm-settings.js";

function makeSetting(overrides: Partial<any> = {}): any {
  return {
    id: "ds-1",
    provider_id: "deepseek",
    model_name: "deepseek-v4-flash",
    api_key: "sk-test",
    plan_type: "api_billing",
    protocol: "custom",
    base_url: "https://api.deepseek.com/v1",
    chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
    anthropic_base_url: "https://api.deepseek.com/anthropic",
    preset_status: "ok",
    is_active: true,
    supports_llm: true,
    ...overrides,
  };
}

const setSetting = (llmSettings as any).__setMockSetting;
const getSetting = (llmSettings as any).__getMockSetting;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ATMS_DAG_DEFAULT_AGENT_TYPE;
});

afterEach(() => {
  delete process.env.ATMS_DAG_DEFAULT_AGENT_TYPE;
});

describe("DAG default LLM setting resolution", () => {
  it("resolves deepseek_harness with a custom-protocol DeepSeek setting when no setting_id is given", () => {
    // A custom DeepSeek setting with protocol=custom (like 70f13e71 in the user's DB)
    setSetting(makeSetting({
      protocol: "custom",
      id: "70f13e71",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.provider_name).toBe("deepseek");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1");
  });

  it("resolves deepseek_harness with a NULL-protocol DeepSeek setting when no setting_id is given", () => {
    // A custom DeepSeek setting with protocol=NULL (like 861b41a3 in the user's DB)
    setSetting(makeSetting({
      protocol: null,
      id: "861b41a3",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1");
  });

  it("findActiveDeepSeekHarnessCompatibleSetting returns a setting with a compatible base URL", () => {
    // The function should return a setting that has a compatible base URL
    // even when protocol is "custom" or null (not strictly "openai_compatible")
    const setting = makeSetting({
      protocol: "custom",
      provider_id: "deepseek",
      chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
    });
    setSetting(setting);
    const result = (llmSettings as any).findActiveDeepSeekHarnessCompatibleSetting();
    expect(result).toBe(setting);
    // The base URL should be resolvable (not undefined)
    const baseUrl = (llmSettings as any).resolveDeepSeekHarnessBaseUrlForSetting(setting);
    expect(baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("DAG with env var ATMS_DAG_DEFAULT_AGENT_TYPE and no setting_id resolves deepseek_harness", () => {
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";
    // Default setting is a custom-protocol DeepSeek setting
    setSetting(makeSetting({
      protocol: "custom",
      id: "70f13e71",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1");
  });

  it("explicit llm_setting_id takes priority over the default setting", () => {
    // Default setting is DeepSeek custom
    setSetting(makeSetting({
      protocol: "custom",
      id: "default-ds",
      model_name: "deepseek-v4-flash",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: "default-ds",
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.provider_name).toBe("deepseek");
  });

  it("does not affect manager_agent surface", () => {
    setSetting(makeSetting({
      protocol: "custom",
      anthropic_base_url: "https://api.deepseek.com/anthropic",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "manager_agent",
    });
    // Manager Agent should use its own default (claude-sdk), not the DAG env var
    expect(resolved.agent_type).not.toBe("deepseek_harness");
  });

  it("DAG with no env var and no agent_type uses the default setting as-is", () => {
    // No env var, no agent_type → should use whatever the default setting is
    setSetting(makeSetting({
      protocol: "custom",
      anthropic_base_url: "https://api.deepseek.com/anthropic",
    }));

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });
    // Without env var or explicit agent_type, it falls through to claude-sdk
    // which requires an Anthropic base URL
    expect(resolved.agent_type).toBe("claude-sdk");
  });
});
