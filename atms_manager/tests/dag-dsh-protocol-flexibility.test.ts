/**
 * TDD: DSH harness should accept settings with protocol "custom" or NULL
 * (not just "openai_compatible"). The DSH harness uses the OpenAI Chat
 * Completions API regardless of the protocol label.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _clearAllSettings,
  createSetting,
} from "../src/persistence/llm-settings.js";
import { closeDb } from "../src/persistence/db.js";
import { resolveAgentRuntimeConfig } from "../src/runtime/agent-runtime-resolver.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("DSH harness accepts custom/NULL protocol settings", () => {
  let tmpHome: string;
  let oldHome: string | undefined;

  beforeEach(() => {
    oldHome = process.env.ATMS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "atms-dsh-proto-"));
    process.env.ATMS_HOME = tmpHome;
    closeDb();
    _clearAllSettings();
    // deepseek is a built-in catalog provider; upsertProvider would reject it.
    // No need to call upsertProvider — createSetting works with existing catalog providers.
  });

  afterEach(() => {
    _clearAllSettings();
    closeDb();
    if (oldHome === undefined) delete process.env.ATMS_HOME;
    else process.env.ATMS_HOME = oldHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("DAG with protocol=custom DeepSeek setting → deepseek_harness with base_url", () => {
    const setting = createSetting({
      provider_id: "deepseek",
      endpoint_id: "deepseek_custom",
      model_name: "deepseek-v4-flash",
      api_key: "sk-test",
      protocol: "custom",
      base_url: "https://api.deepseek.com/v1",
      chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
      is_active: true,
      is_default: true,
    });
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.protocol).toBe("openai_compatible");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(resolved.llm_setting_id).toBe(setting.id);
  });

  it("DAG with protocol=NULL DeepSeek setting → deepseek_harness with base_url", () => {
    const setting = createSetting({
      provider_id: "deepseek",
      endpoint_id: "deepseek_custom",
      model_name: "deepseek-v4-flash",
      api_key: "sk-test",
      protocol: null,
      base_url: "https://api.deepseek.com/v1",
      chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
      is_active: true,
      is_default: true,
    });
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.protocol).toBe("openai_compatible");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("DAG with env var + no setting_id → auto-selects custom-protocol DeepSeek setting", () => {
    process.env.ATMS_DAG_DEFAULT_AGENT_TYPE = "deepseek_harness";
    createSetting({
      provider_id: "deepseek",
      endpoint_id: "deepseek_custom",
      model_name: "deepseek-v4-flash",
      api_key: "sk-test",
      protocol: "custom",
      base_url: "https://api.deepseek.com/v1",
      chat_completions_base_url: "https://api.deepseek.com/v1/chat/completions",
      is_active: true,
      is_default: true,
    });
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.protocol).toBe("openai_compatible");
    expect(resolved.base_url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("anthropic_compatible protocol without OpenAI URL falls back to default base URL", () => {
    const setting = createSetting({
      provider_id: "deepseek",
      endpoint_id: "deepseek_custom",
      model_name: "deepseek-v4-flash",
      api_key: "sk-test",
      protocol: "anthropic_compatible",
      anthropic_base_url: "https://api.anthropic.com",
      is_active: true,
      is_default: true,
    });
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
      agentType: "deepseek_harness",
    });
    // anthropic_compatible has no OpenAI URL → resolver falls back to default base_url
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.protocol).toBe("openai_compatible");
    expect(resolved.base_url).toBe("https://api.deepseek.com");
  });
});
