/**
 * TDD: Verify workflow YAML parses correctly with:
 * 1. agent_type: deepseek_harness on all agents
 * 2. worker_policy with allowed_builtin_tools + workspace_access on fanout
 */
import { describe, it, expect } from "vitest";
import YAML from "yaml";

describe("phase2a-backend-fanout-v2 YAML (deepseek_harness)", () => {
  let parsed: any;

  it("parses valid YAML", () => {
    const yamlText = require("fs").readFileSync(
      "/tmp/workflow_dsh.yaml", "utf-8"
    );
    parsed = YAML.parse(yamlText);
    expect(parsed).toBeDefined();
  });

  it("has agent_type deepseek_harness on all agents", () => {
    const agents = parsed.spec.agents;
    for (const [name, cfg] of Object.entries(agents)) {
      expect(cfg.agent_type, `agent ${name} should have agent_type`).toBe("deepseek_harness");
    }
  });

  it("has worker_policy with builtin tools on fanout", () => {
    const fanout = parsed.spec.nodes.fanout;
    const config = fanout.config;
    expect(config.worker_policy).toBeDefined();
    expect(config.worker_policy.allowed_builtin_tools).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "LS"])
    );
    expect(config.worker_policy.workspace_access).toBeDefined();
    expect(config.worker_policy.workspace_access.writable_paths).toContain(
      "{{fanout_workspace}}"
    );
  });

  it("keeps handoff as the only DAG tool for workers", () => {
    const fanout = parsed.spec.nodes.fanout;
    const config = fanout.config;
    expect(config.worker_policy.allowed_dag_tools).toEqual(["handoff"]);
  });

  it("keeps orchestrator and verifier tool-free (handoff only)", () => {
    const plan = parsed.spec.nodes.plan;
    const verify = parsed.spec.nodes.verify;
    expect(plan.allowed_builtin_tools).toEqual([]);
    expect(verify.allowed_builtin_tools).toEqual([]);
    expect(plan.allowed_dag_tools).toEqual(["handoff"]);
    expect(verify.allowed_dag_tools).toEqual(["handoff"]);
  });
});
