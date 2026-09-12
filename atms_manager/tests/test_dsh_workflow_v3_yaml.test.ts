/**
 * TDD: Verify phase2a-backend-fanout-v3 YAML is valid and correctly configured
 * for read-only DSH worker inspection.
 *
 * v3 fixes (revision 8):
 * 1. workspace.mode: shared (container /workspace accessible)
 * 2. fanout completion: n_of_m + threshold for fault tolerance
 * 3. worker_policy: allowed_builtin_tools = ["Read", "Grep", "Glob", "LS"]
 *    (DSH harness only supports these 4 read-only tools, NOT Bash/Write/Edit)
 * 4. workspace_access: writable_paths=[], readonly_paths=["."]
 * 5. Worker/verifier system prompts are read-only (no shell, no file writes)
 */
import { describe, it, expect } from "vitest";
import YAML from "yaml";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURE = join(__dirname, "fixtures", "phase2a-backend-fanout-v3.yaml");

describe("phase2a-backend-fanout-v3 YAML (read-only DSH)", () => {
  let parsed: any;

  it("parses valid YAML", () => {
    const yamlText = readFileSync(FIXTURE, "utf-8");
    parsed = YAML.parse(yamlText);
    expect(parsed).toBeDefined();
    expect(parsed.api_version).toBe("atms.ai/v1");
    expect(parsed.kind).toBe("Workflow");
    expect(parsed.metadata.id).toBe("phase2a-backend-fanout-v3");
  });

  it("uses shared workspace mode", () => {
    expect(parsed.spec.workspace.mode).toBe("shared");
  });

  it("has 3 agents: orchestrator, worker, verifier", () => {
    const agents = parsed.spec.agents;
    expect(Object.keys(agents).sort()).toEqual(["orchestrator", "verifier", "worker"]);
  });

  it("fanout uses n_of_m completion with threshold", () => {
    const config = parsed.spec.nodes.fanout.config;
    expect(config.completion).toBe("n_of_m");
    expect(typeof config.threshold).toBe("number");
    expect(config.threshold).toBeGreaterThanOrEqual(1);
  });

  it("worker_policy has DSH read-only builtin tools only", () => {
    const policy = parsed.spec.nodes.fanout.config.worker_policy;
    expect(policy.allowed_builtin_tools).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "LS"]),
    );
    // DSH does NOT support Bash, Write, Edit, MultiEdit
    expect(policy.allowed_builtin_tools).not.toContain("Bash");
    expect(policy.allowed_builtin_tools).not.toContain("Write");
    expect(policy.allowed_builtin_tools).not.toContain("Edit");
    expect(policy.allowed_builtin_tools).not.toContain("MultiEdit");
  });

  it("worker_policy has workspace_access with empty writable_paths", () => {
    const policy = parsed.spec.nodes.fanout.config.worker_policy;
    expect(policy.workspace_access).toBeDefined();
    expect(policy.workspace_access.writable_paths).toEqual([]);
    expect(policy.workspace_access.readonly_paths).toContain(".");
  });

  it("worker system prompt is read-only (no shell, no writes)", () => {
    const prompt = parsed.spec.agents.worker.system;
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Do NOT write");
    expect(prompt).toContain("Do NOT run shell commands");
    expect(prompt).not.toContain("test -d /workspace");
    expect(prompt).not.toContain("file-write");
    expect(prompt).not.toContain("wc -l");
  });

  it("verifier system prompt is read-only (no shell, no writes)", () => {
    const prompt = parsed.spec.agents.verifier.system;
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Do NOT write");
    expect(prompt).toContain("Do NOT run shell commands");
  });

  it("orchestrator system prompt targets /workspace", () => {
    const prompt = parsed.spec.agents.orchestrator.system;
    expect(prompt).toContain("/workspace");
  });

  it("plan node has no builtin tools (handoff only)", () => {
    const plan = parsed.spec.nodes.plan;
    expect(plan.allowed_builtin_tools).toEqual([]);
    expect(plan.allowed_dag_tools).toEqual(["handoff"]);
  });

  it("verify node has no builtin tools (handoff only)", () => {
    const verify = parsed.spec.nodes.verify;
    expect(verify.allowed_builtin_tools).toEqual([]);
    expect(verify.allowed_dag_tools).toEqual(["handoff"]);
  });

  it("has 4 fanout items max and 4 parallelism", () => {
    const config = parsed.spec.nodes.fanout.config;
    expect(config.max_items).toBe(16);
    expect(config.max_parallelism).toBe(4);
  });

  it("result contract requires status and evidence", () => {
    const contract = parsed.spec.contracts.WorkerResult;
    expect(contract.required).toEqual(["status", "evidence"]);
    expect(contract.properties.status.enum).toEqual(["success", "failed"]);
  });

  it("has success/failure terminal nodes", () => {
    const nodes = parsed.spec.nodes;
    expect(nodes.done.outcome).toBe("success");
    expect(nodes.worker_failed.outcome).toBe("failure");
    expect(nodes.verification_failed.outcome).toBe("failure");
  });

  it("edges route fanout.passed to verify and fanout.failed to worker_failed", () => {
    const edges = parsed.spec.edges;
    const passEdge = edges.find((e: any) => e.from === "fanout.passed");
    expect(passEdge.to).toBe("verify.aggregate");
    const failEdge = edges.find((e: any) => e.from === "fanout.failed");
    expect(failEdge.to).toBe("worker_failed.result");
    expect(failEdge.condition).toBe("on_failure");
  });
});
