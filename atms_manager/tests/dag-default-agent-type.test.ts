import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the persistence layer before importing the resolver.
vi.mock("../src/persistence/llm-settings.js", () => {
  let mockSetting: any = null;
  return {
    findActiveCodexCompatibleSetting: vi.fn(() => null),
    findActiveDeepSeekHarnessCompatibleSetting: vi.fn(() => mockSetting),
    findActiveClaudeSdkCompatibleSetting: vi.fn(() => mockSetting),
    findActiveLlmRuntimeSetting: vi.fn(() => mockSetting),
    findActiveSetting: vi.fn(() => mockSetting),
    getProvider: vi.fn(() => ({ name: "Mock" })),
    getSetting: vi.fn(() => mockSetting),
    isVoiceServiceSetting: vi.fn(() => false),
    resolveCodexResponsesBaseUrlForSetting: vi.fn(() => undefined),
    resolveDeepSeekHarnessBaseUrlForSetting: vi.fn((s: any) =>
      s?.protocol === "openai_compatible" ? s?.chat_completions_base_url ?? s?.base_url : undefined,
    ),
    resolveClaudeSdkBaseUrlForSetting: vi.fn((s: any) => s?.anthropic_base_url ?? undefined),
    resolveClaudeSdkAuthModeForSetting: vi.fn(() => "api_key"),
    // Test helper
    __setMockSetting: (s: any) => { mockSetting = s; },
    __getMockSetting: () => mockSetting,
  };
});

vi.mock("../src/persistence/provider-catalog.js", () => ({
  canonicalModelNameForEndpoint: vi.fn((_p: string, _e: string, m: string) => m),
  findCatalogEndpoint: vi.fn(() => null),
  findEndpointModel: vi.fn(() => null),
  isKimiProviderId: vi.fn(() => false),
  KIMI_CN_PROVIDER_ID: "kimi-cn",
  KIMI_PROVIDER_ID: "kimi",
}));

import { resolveAgentRuntimeConfig } from "../src/runtime/agent-runtime-resolver.js";
import * as mockLlmSettings from "../src/persistence/llm-settings.js";

const mockLlm = mockLlmSettings as any;

/** Build a minimal LLMSetting-like object. */
function makeSetting(overrides: Partial<any> = {}): any {
  return {
    id: "test-setting",
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

describe("ATMS_DAG_DEFAULT_AGENT_TYPE env var", () => {
  let oldEnv: string | undefined;

  beforeEach(() => {
    oldEnv = process.env.ATMS_DAG_DEFAULT_AGENT_TYPE;
    delete process.env.ATMS_DAG_DEFAULT_AGENT_TYPE;
  });

  afterEach(() => {
    if (oldEnv === undefined) delete process.env.ATMS_DAG_DEFAULT_AGENT_TYPE;
    else process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = oldEnv;
    vi.resetAllMocks();
  });

  it("returns deepseek_harness when env var is set and setting protocol is not openai_compatible", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "custom" }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      // no explicit agent_type, no explicit setting_id
    });

    expect(resolved.agent_type).toBe("deepseek_harness");
  });

  it("returns deepseek_harness when env var is set and setting protocol is openai_compatible", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "openai_compatible" }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });

    expect(resolved.agent_type).toBe("deepseek_harness");
  });

  it("returns claude-sdk when env var is NOT set and protocol is custom (existing behavior)", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "custom" }));
    // env var not set

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });

    // claude-sdk is the default (DEFAULT_MANAGER_AGENT_RUNTIME_AGENT_TYPE)
    expect(resolved.agent_type).toBe("claude-sdk");
  });

  it("returns openai_compatible default (deepseek_harness) when protocol is openai_compatible even without env var", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "openai_compatible" }));
    // env var not set — existing auto-detection handles this

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });

    expect(resolved.agent_type).toBe("deepseek_harness");
  });

  it("explicit agent_type in workflow YAML overrides the env var", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "custom" }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      agentType: "claude-sdk",
    });

    expect(resolved.agent_type).toBe("claude-sdk");
  });

  it("env var does not affect manager_agent surface", () => {
    mockLlm.__setMockSetting(makeSetting({ protocol: "custom" }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "manager_agent",
    });

    // manager_agent uses its own default, not the DAG env var
    expect(resolved.agent_type).not.toBe("deepseek_harness");
  });

  it("env var with explicit setting_id still works", () => {
    mockLlm.__setMockSetting(makeSetting({ id: "861b41a3", protocol: "openai_compatible" }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: "861b41a3",
    });

    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.llm_setting_id).toBe("861b41a3");
  });

  it("deepseek_harness env var with non-openai_compatible setting still resolves (no protocol guard)", () => {
    // The env var forces deepseek_harness regardless of setting protocol.
    // The base URL comes from chat_completions_base_url.
    mockLlm.__setMockSetting(makeSetting({
      protocol: "custom",
      chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
    }));
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";

    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });

    expect(resolved.agent_type).toBe("deepseek_harness");
    // base_url should be the chat_completions_base_url
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1/chat/completions");
  });
});
