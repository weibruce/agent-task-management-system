import type * as http from "node:http";
import {
  ATMS_UI_TOOL_NAMES,
  MANAGER_AGENT_COMMON_TOOL_NAMES,
  MANAGER_AGENT_COMMON_VOICE_TOOL_NAMES,
  MANAGER_AGENT_TOOL_SPECS,
  TOOL_PROVIDER_CATALOG_VERSION,
  type ManagerAgentToolName,
  type ToolProviderBinding,
  type ToolProviderCatalog,
  type ToolProviderDescriptor,
} from "atms-protocol";

import { getBrowserToolsBroker } from "./browser-tools-websocket.js";
import { getBrowserRendererToolsBroker } from "./browser-renderer-tools-websocket.js";

const DAG_TOOL_PATTERN = /(?:^|_)(?:dag|run|orchestration|change|approval|trigger)(?:_|$)/;
const UI_TOOL_NAMES = new Set<string>(ATMS_UI_TOOL_NAMES);
const VOICE_TOOL_NAMES = new Set<string>(MANAGER_AGENT_COMMON_VOICE_TOOL_NAMES);

function tools(names: readonly string[]) {
  return [...new Set(names)].sort().flatMap((name) => {
    const spec = MANAGER_AGENT_TOOL_SPECS[name as ManagerAgentToolName];
    return spec ? [{ name: spec.name, description: spec.description }] : [];
  });
}

function inProcessBindings(): ToolProviderBinding[] {
  return ["manager_agent", "gpt_live"].map((harness) => ({
    harness: harness as "manager_agent" | "gpt_live",
    execution_host: "manager",
    transport: "in_process",
    runtime_state: "available",
  }));
}

function builtinProvider(input: {
  id: string;
  name: string;
  description: string;
  toolNames: readonly string[];
}): ToolProviderDescriptor {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    kind: "builtin_tools",
    configuration_state: "built_in",
    read_only_configuration: true,
    tools: tools(input.toolNames),
    bindings: inProcessBindings(),
  };
}

export function buildToolProviderCatalog(
  input: { browserConnected?: boolean } = {},
): ToolProviderCatalog {
  const commonNames = MANAGER_AGENT_COMMON_TOOL_NAMES.filter((name) => !UI_TOOL_NAMES.has(name));
  const dagNames = commonNames.filter((name) => DAG_TOOL_PATTERN.test(name));
  const coreNames = commonNames.filter((name) => !DAG_TOOL_PATTERN.test(name));
  const browserRuntime = input.browserConnected ? "connected" : "disconnected";

  return {
    version: TOOL_PROVIDER_CATALOG_VERSION,
    generated_at: new Date().toISOString(),
    providers: [
      builtinProvider({
        id: "atms.manager-core",
        name: "Atms Manager Tools",
        description: "Built-in project, Skill, validation, and Manager control tools.",
        toolNames: coreNames,
      }),
      builtinProvider({
        id: "atms.dag-control",
        name: "Atms DAG Tools",
        description: "Built-in DAG creation, execution, supervision, and run-control tools.",
        toolNames: dagNames,
      }),
      builtinProvider({
        id: "atms.generative-ui",
        name: "Atms Generative UI Tools",
        description: "Built-in Live Voice and generated-widget presentation tools.",
        toolNames: [...VOICE_TOOL_NAMES],
      }),
      {
        id: "atms.browser-ui",
        name: "Experimental Browser UI Tools",
        description: "Trusted semantic Atms interface actions exposed through WebMCP.",
        kind: "webmcp",
        configuration_state: "experimental",
        read_only_configuration: true,
        tools: tools(ATMS_UI_TOOL_NAMES),
        bindings: ["manager_agent", "gpt_live"].map((harness) => ({
          harness: harness as "manager_agent" | "gpt_live",
          execution_host: "renderer" as const,
          transport: "browser_tools_ws" as const,
          runtime_state: browserRuntime,
        })),
      },
    ],
  };
}

export function toolProviderRoutesHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = new URL(req.url || "/", "http://localhost").pathname.replace(/\/$/, "");
  if (pathname !== "/api/tool-providers") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json", Allow: "GET" });
    res.end(JSON.stringify({ success: false, error: "method not allowed" }));
    return true;
  }
  const catalog = buildToolProviderCatalog({
    browserConnected: Boolean(
      getBrowserToolsBroker()?.ready()
      || getBrowserRendererToolsBroker()?.connected(),
    ),
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, data: catalog }));
  return true;
}
