/**
 * TDD: When a DAG node uses an openai_compatible LLM setting (no explicit
 * agent_type), the resolver should default to deepseek_harness instead of
 * claude-sdk. This makes DeepSeek V4 Flash + deepseek-harness the natural
 * default for DAG execution with OpenAI-compatible endpoints.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../src/persistence/db.js";
import {
  _clearAllSettings,
  createSetting,
  upsertProvider,
} from "../src/persistence/llm-settings.js";
import { resolveAgentRuntimeConfig } from "../src/runtime/agent-runtime-resolver.js";

describe("agent-runtime-resolver: DAG openai_compatible → deepseek_harness", () => {
  let tmpHome: string;
  let oldHome: string | undefined;

  beforeEach(() => {
    oldHome = process.env.ATMS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "atms-dag-dsh-"));
    process.env.ATMS_HOME = tmpHome;
    closeDb();
    _clearAllSettings();
  });

  afterEach(() => {
    _clearAllSettings();
    closeDb();
    if (oldHome === undefined) delete process.env.ATMS_HOME;
    else process.env.ATMS_HOME = oldHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function makeOpenAISetting(modelName = "qwen3.8-27b") {
    upsertProvider({
      id: "local-ollama",
      name: "Local Ollama",
      default_model: modelName,
    });
    return createSetting({
      provider_id: "local-ollama",
      endpoint_id: "local-ollama_custom",
      model_name: modelName,
      api_key: "no-key",
      protocol: "openai_compatible",
      chat_completions_base_url: "http://127.0.0.1:8080/v1",
      is_active: true,
      is_default: true,
    });
  }

  it("DAG with openai_compatible setting → deepseek_harness", () => {
    const setting = makeOpenAISetting();
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
    expect(resolved.protocol).toBe("openai_compatible");
  });

  it("DAG with explicit agent_type=deepseek_harness is respected", () => {
    const setting = makeOpenAISetting();
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
      agentType: "deepseek_harness",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
  });

  it("DAG with anthropic_compatible setting still defaults to claude-sdk", () => {
    upsertProvider({
      id: "anthropic-local",
      name: "Anthropic Local",
      default_model: "claude-sonnet-4-6",
    });
    const setting = createSetting({
      provider_id: "anthropic-local",
      endpoint_id: "anthropic-local_custom",
      model_name: "claude-sonnet-4-6",
      api_key: "sk-ant-test",
      protocol: "anthropic_compatible",
      anthropic_base_url: "http://127.0.0.1:9999/v1",
      is_active: true,
      is_default: true,
    });
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
      settingId: setting.id,
    });
    expect(resolved.agent_type).toBe("claude-sdk");
  });

  it("manager_agent with openai_compatible setting still defaults to claude-sdk", () => {
    const setting = makeOpenAISetting();
    // manager_agent surface should NOT be affected by the DAG default change
    expect(() => resolveAgentRuntimeConfig({
      surface: "manager_agent",
      settingId: setting.id,
    })).toThrow("Claude SDK requires an Anthropic-compatible endpoint");
  });

  it("DAG with no setting (findActiveLlmRuntimeSetting) → deepseek_harness if openai_compatible", () => {
    // No explicit settingId — resolver finds the active LLM setting
    // which is openai_compatible → should default to deepseek_harness
    makeOpenAISetting();
    const resolved = resolveAgentRuntimeConfig({
      surface: "dag",
    });
    expect(resolved.agent_type).toBe("deepseek_harness");
  });
});
