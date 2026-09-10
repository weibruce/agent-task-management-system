/**
 * Atms plugin package protocol.
 *
 * The manifest is intentionally declarative. It describes a vertical
 * capability slice without granting a package arbitrary Manager or UI code.
 * @version 0.1.0
 */

import type {
  GenerativeUiCanvasSize,
  GenerativeUiDevice,
  GenerativeUiDensity,
  GenerativeUiSurface,
  GenerativeUiNodeV1,
  GenerativeUiTransactionV1,
  GenerativeUiDocumentScopeV1,
  GenerativeUiImportance,
  GenerativeUiMotionProfile,
  GenerativeUiPersistence,
  GenerativeUiActionStyle,
} from "../generative-ui/types.js";

export const ATMS_PLUGIN_MANIFEST_VERSION = 1 as const;
export const ATMS_PLUGIN_ID_PATTERN_SOURCE = "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" as const;
export const ATMS_PLUGIN_ID_PATTERN = new RegExp(ATMS_PLUGIN_ID_PATTERN_SOURCE);

export function isAtmsPluginId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 160
    && ATMS_PLUGIN_ID_PATTERN.test(value);
}
export type AtmsPluginManifestVersion = typeof ATMS_PLUGIN_MANIFEST_VERSION;

export const ATMS_PLUGIN_API_VERSION = 1 as const;
export const ATMS_RENDERER_API_VERSION = 1 as const;
export const ATMS_ACTION_BUS_VERSION = 1 as const;
export const ATMS_TOOL_BUS_VERSION = 1 as const;
export const ATMS_RUNTIME_RPC_VERSION = 1 as const;
/** Capability claims are deliberately short lived and single use. */
export const ATMS_ACTION_CAPABILITY_MAX_TTL_MS = 5 * 60 * 1000;
export const ATMS_ACTION_CONFIRMATION_MAX_TTL_MS = 10 * 60 * 1000;
export const ATMS_ACTION_REQUEST_MAX_TTL_MS = 15 * 60 * 1000;
export const ATMS_ACTION_ARGUMENT_MAX_BYTES = 32 * 1024;
export const ATMS_RUNTIME_DOMAIN_OUTPUT_MAX_BYTES = 256 * 1024;
export const ATMS_RUNTIME_LOG_MAX_ITEMS = 128;
export const ATMS_RUNTIME_ARTIFACT_MAX_ITEMS = 32;

export const AtmsPluginModality = {
  VOICE: "voice",
  TEXT: "text",
  TOUCH: "touch",
  GAMEPAD: "gamepad",
  AUTOMATION: "automation",
} as const;
export type AtmsPluginModality =
  (typeof AtmsPluginModality)[keyof typeof AtmsPluginModality];

export const AtmsPluginEffect = {
  READ: "read",
  WRITE: "write",
  EXTERNAL: "external",
  DESTRUCTIVE: "destructive",
} as const;
export type AtmsPluginEffect =
  (typeof AtmsPluginEffect)[keyof typeof AtmsPluginEffect];

export const AtmsPluginConfirmation = {
  NEVER: "never",
  POLICY: "policy",
  ALWAYS: "always",
} as const;
export type AtmsPluginConfirmation =
  (typeof AtmsPluginConfirmation)[keyof typeof AtmsPluginConfirmation];

export const AtmsPluginRuntimeTrust = {
  DATA_ONLY: "data_only",
  SANDBOXED_RUNTIME: "sandboxed_runtime",
  TRUSTED_BUILTIN: "trusted_builtin",
} as const;
export type AtmsPluginRuntimeTrust =
  (typeof AtmsPluginRuntimeTrust)[keyof typeof AtmsPluginRuntimeTrust];

export const AtmsPluginHandlerType = {
  PROJECTION: "projection",
  RUNTIME: "runtime",
  BUILTIN: "builtin",
} as const;
export type AtmsPluginHandlerType =
  (typeof AtmsPluginHandlerType)[keyof typeof AtmsPluginHandlerType];

export const AtmsPluginRendererMode = {
  BUILTIN: "builtin",
  DECLARATIVE: "declarative",
  CUSTOM: "custom",
} as const;
export type AtmsPluginRendererMode =
  (typeof AtmsPluginRendererMode)[keyof typeof AtmsPluginRendererMode];

export const AtmsPluginPermission = {
  WORKSPACE_READ: "workspace.read",
  WORKSPACE_WRITE: "workspace.write",
  ARTIFACT_READ: "artifact.read",
  ARTIFACT_WRITE: "artifact.write",
  PLUGIN_DATA_READ: "plugin_data.read",
  PLUGIN_DATA_WRITE: "plugin_data.write",
  NETWORK_CONNECT: "network.connect",
  SECRET_USE: "secret.use",
  PROCESS_SPAWN: "process.spawn",
  GPU_USE: "gpu.use",
  DEVICE_CONTROL: "device.control",
  CAMERA_READ: "camera.read",
  MICROPHONE_READ: "microphone.read",
  NOTIFICATION_SEND: "notification.send",
} as const;
export type AtmsPluginPermission =
  (typeof AtmsPluginPermission)[keyof typeof AtmsPluginPermission];

export interface AtmsPluginCompatibilityV1 {
  atms: {
    min: string;
    max_exclusive: string;
  };
  plugin_api: number[];
  ui_ir: number[];
  renderer_api: number[];
}

export interface AtmsPluginPublisherV1 {
  id: string;
  name: string;
}

export interface AtmsPluginCapabilityV1 {
  id: string;
  summary: string;
  intents: string[];
  tags?: string[];
  modalities: AtmsPluginModality[];
  required_inputs: string[];
  skill: string;
  tools: string[];
  workflows: string[];
  actions: string[];
}

export interface AtmsPluginSkillV1 {
  id: string;
  path: string;
  /** @deprecated Skill YAML frontmatter is the canonical discovery description. */
  description?: string;
  /** Optional digest-pinned Worker Surface profile owned by this Skill. */
  visual_profile?: string;
}

export interface AtmsPluginSchemaV1 {
  id: string;
  file: string;
}

export interface AtmsPluginKindVersionV1 {
  version: number;
  content_schema: string;
  allowed_surfaces: GenerativeUiSurface[];
  default_surface: GenerativeUiSurface;
  default_variant: GenerativeUiDensity;
  max_content_bytes: number;
  preferred_visuals: string[];
  fallback: "portable_required";
  /** Manifest action ids that this kind version may expose. */
  actions: string[];
}

export interface AtmsPluginKindMigrationV1 {
  from: number;
  to: number;
  file: string;
}

export interface AtmsPluginKindV1 {
  kind: string;
  current_version: number;
  versions: AtmsPluginKindVersionV1[];
  migrations: AtmsPluginKindMigrationV1[];
}

export type AtmsPluginHandlerV1 =
  | { type: "projection"; file: string }
  | { type: "runtime"; method: string }
  | { type: "builtin"; id: string };

export type AtmsPluginResolvedHandlerV1 =
  | {
      type: "projection";
      file: string;
      digest: string;
      document: Record<string, unknown>;
    }
  | { type: "runtime"; method: string }
  | { type: "builtin"; id: string };

export interface AtmsPluginToolV1 {
  id: string;
  description: string;
  /** Explicit callable surfaces; Action-only Tools never enter Agent catalogs. */
  exposure: Array<"agent" | "action">;
  input_schema: string;
  output_schema?: string;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  confirmation: AtmsPluginConfirmation;
  handler: AtmsPluginHandlerV1;
}

export interface AtmsPluginWorkflowV1 {
  id: string;
  uri: string;
  file: string;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  confirmation: AtmsPluginConfirmation;
}

export interface AtmsPluginRendererV1 {
  id: string;
  kind: string;
  kind_version: number;
  renderer_api: number;
  mode: AtmsPluginRendererMode;
  surfaces: GenerativeUiSurface[];
  devices: GenerativeUiDevice[];
  source:
    | { type: "builtin"; id: string }
    | { type: "declarative"; file: string }
    | { type: "custom"; file: string };
  fallback:
    | { type: "portable" }
    | { type: "core_projection"; file: string };
}

/**
 * Safe, expression-free Renderer DSL for data-only plugins. All JSON pointers
 * are evaluated relative to semantic node.content. HTML, CSS, scripts,
 * templates, network requests, and arbitrary component imports are absent by
 * construction.
 */
export interface AtmsDeclarativeRendererV1 {
  renderer_version: 1;
  type: "card";
  title_pointer: string;
  subtitle_pointer?: string;
  empty_message?: string;
  sections: AtmsDeclarativeRendererSectionV1[];
}

export type AtmsDeclarativeRendererSectionV1 =
  | {
      id: string;
      type: "text";
      label?: string;
      pointer: string;
      max_lines?: number;
    }
  | {
      id: string;
      type: "list";
      label?: string;
      pointer: string;
      item_title_pointer: string;
      item_detail_pointer?: string;
      item_badge_pointer?: string;
      max_items?: number;
    }
  | {
      id: string;
      type: "metrics";
      label?: string;
      items: Array<{
        label: string;
        pointer: string;
        format: "text" | "number" | "percent";
      }>;
    }
  | {
      id: string;
      type: "links";
      label?: string;
      pointer: string;
      item_label_pointer: string;
      item_uri_pointer: string;
      max_items?: number;
    };

export type AtmsPluginResolvedRendererSourceV1 =
  | { type: "builtin"; id: string }
  | {
      type: "declarative";
      file: string;
      digest: string;
      document: AtmsDeclarativeRendererV1;
    }
  | {
      /**
       * An immutable ES module fetched by exact package identity and executed
       * only inside the Agent UI's opaque-origin Renderer sandbox.
       */
      type: "custom";
      file: string;
      digest: string;
    };

export interface AtmsPluginActionV1 {
  id: string;
  intent: string;
  /** Same-plugin Tool that is the sole execution and policy authority. */
  tool: string;
}

export interface AtmsPluginPermissionGrantV1 {
  permission: AtmsPluginPermission;
  paths?: string[];
  hosts?: string[];
}

export interface AtmsPluginRuntimeV1 {
  trust: AtmsPluginRuntimeTrust;
  plugin_api: number;
  entrypoint?: {
    file: string;
    args: string[];
  };
}

export interface AtmsPluginStateMigrationV1 {
  from: number;
  to: number;
  file: string;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  confirmation: AtmsPluginConfirmation;
}

export interface AtmsPluginStateV1 {
  schema_version: number;
  migrations: AtmsPluginStateMigrationV1[];
}

export interface AtmsPluginManifestV1 {
  manifest_version: AtmsPluginManifestVersion;
  id: string;
  version: string;
  name: string;
  publisher: AtmsPluginPublisherV1;
  license: string;
  compatibility: AtmsPluginCompatibilityV1;
  capabilities: AtmsPluginCapabilityV1[];
  skills: AtmsPluginSkillV1[];
  schemas: AtmsPluginSchemaV1[];
  kinds: AtmsPluginKindV1[];
  tools: AtmsPluginToolV1[];
  workflows: AtmsPluginWorkflowV1[];
  renderers: AtmsPluginRendererV1[];
  actions: AtmsPluginActionV1[];
  runtime: AtmsPluginRuntimeV1;
  permissions: {
    required: AtmsPluginPermissionGrantV1[];
    optional: AtmsPluginPermissionGrantV1[];
  };
  state: AtmsPluginStateV1;
}

export interface AtmsDirectUiProjectionV1 {
  projection_version: 1;
  type: "direct_ui_node";
  kind: string;
  kind_version: number;
  /** RFC 6901 JSON Pointer into Tool arguments. */
  node_id_pointer: string;
  /** RFC 6901 JSON Pointer to an object copied into semantic content. */
  content_pointer: string;
  /** Optional RFC 6901 pointer to a direct A2UI surface copied outside semantic content. */
  a2ui_pointer?: string;
  /** Optional bounded presentation bindings; defaults remain authoritative when absent. */
  surface_pointer?: string;
  importance_pointer?: string;
  density_pointer?: string;
  canvas_size_pointer?: string;
  motion_profile_pointer?: string;
  persistence_pointer?: string;
  omit_content_fields: string[];
  fallback: {
    title_pointer: string;
    summary_pointer?: string;
    items_pointer?: string;
    item_projections?: AtmsDirectUiFallbackItemProjectionV1[];
  };
  defaults: {
    surface: GenerativeUiSurface;
    importance: GenerativeUiImportance;
    density: GenerativeUiDensity;
    canvas_size?: GenerativeUiCanvasSize;
    motion_profile?: GenerativeUiMotionProfile;
    persistence: GenerativeUiPersistence;
  };
  /** Safe Action presentation/binding; execution policy remains Tool-owned. */
  actions?: Array<{
    id: string;
    label: string;
    style?: GenerativeUiActionStyle;
    /** RFC 6901 pointer to a Tool-input object snapshotted as fixed Action arguments. */
    arguments_pointer?: string;
  }>;
  /** Explicit reversible bridge while the legacy Voice surface remains live. */
  legacy_bridge?: {
    widget_type: string;
    visual: string;
  };
}

export interface AtmsDirectUiFallbackItemProjectionV1 {
  pointer: string;
  mode: "scalar" | "strings" | "records";
  prefix?: string;
  title_pointer?: string;
  detail_pointer?: string;
  items_pointer?: string;
}

export interface AtmsDirectUiProjectionResultV1 {
  projection_version: 1;
  node: GenerativeUiNodeV1;
  legacy_widget?: Record<string, unknown>;
}

export interface AtmsPluginToolExecutionEnvelopeV1 {
  execution_version: 1;
  status: "projected";
  /** Projection is validated but not committed until Manager accepts it. */
  committed: false;
  plugin: { id: string; version: string };
  tool: { local_id: string; qualified_id: string; wire_id: string; handler_digest: string };
  /** Immutable validated input so Manager can deterministically replay the projection. */
  arguments: Record<string, unknown>;
  projection: AtmsDirectUiProjectionResultV1;
}

/**
 * Exact symbolic identity selected from a Generative UI document. Revisions
 * make an invocation stale as soon as either the document or node changes.
 */
export interface AtmsPluginActionTargetV1 {
  document_id: string;
  document_revision: number;
  node_id: string;
  node_revision: number;
  action_id: string;
  action_intent: string;
}

/** Immutable package and Turn Context snapshot resolved by Manager. */
export interface AtmsPluginToolBindingV1 {
  plugin_id: string;
  plugin_version: string;
  manifest_digest: string;
  package_digest: string;
  context_digest: string;
  registry_revision: number;
  permission_revision: number;
}

/**
 * Effective, version-scoped grant resolved by Manager for one Action.
 *
 * This is intentionally separate from the manifest declaration and persisted
 * grant status. It contains only the authority that will be conveyed to the
 * runtime. The grant list, and each paths/hosts list, use ascending canonical
 * order so the exact scope is stable across confirmation, capability and RPC
 * boundaries.
 */
export interface AtmsPluginEffectivePermissionGrantV1 {
  permission: AtmsPluginPermission;
  paths?: string[];
  hosts?: string[];
}

export interface AtmsPluginToolPolicyV1 {
  effect: AtmsPluginEffect;
  /** Canonically sorted exact permission set; capabilities may not widen it. */
  permissions: AtmsPluginPermission[];
  /** Canonically sorted effective authority, including path/host narrowing. */
  effective_grants: AtmsPluginEffectivePermissionGrantV1[];
  confirmation: AtmsPluginConfirmation;
  /** Host policy resolution for the manifest's policy/always/never setting. */
  confirmation_required: boolean;
}

/**
 * Tool Bus V1 request. `request_digest` is the SHA-256 digest of
 * `atmsPluginToolInvocationDigestInput(value)` encoded canonically.
 * The digest therefore binds the exact effective path/host grants in policy.
 * Protocol defines that ABI but intentionally does not sign or issue it.
 */
export interface AtmsPluginToolInvocationV1 {
  tool_bus_version: 1;
  request_id: string;
  idempotency_key: string;
  request_digest: string;
  invoked_at: string;
  deadline_at: string;
  source:
    | {
      type: "ui_action";
      target: AtmsPluginActionTargetV1;
      action: {
        local_id: string;
        qualified_id: string;
      };
      /** Digest of user-supplied Action input before Manager-owned fixed arguments are merged. */
      input_digest: string;
    }
    | {
      type: "agent";
      call_id: string;
      modality: AtmsPluginModality;
      /** Manager-resolved scope and canonical commit target; callers never choose a document id. */
      scope: GenerativeUiDocumentScopeV1;
      target: {
        document_id: string;
        base_revision: number;
      };
    };
  tool: {
    local_id: string;
    qualified_id: string;
    wire_id: string;
    handler:
      | { type: "projection"; digest: string }
      | { type: "runtime"; method: string }
      | { type: "builtin"; id: string };
  };
  binding: AtmsPluginToolBindingV1;
  policy: AtmsPluginToolPolicyV1;
  arguments: Record<string, unknown>;
}

/** Short-lived, single-use bearer capability claims; signing is out of scope. */
export interface AtmsPluginToolCapabilityClaimsV1 {
  capability_version: 1;
  capability_id: string;
  audience: "atms.plugin-runtime";
  scope: "plugin.tool.execute";
  nonce: string;
  single_use: true;
  request_id: string;
  request_digest: string;
  binding: AtmsPluginToolBindingV1;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  effective_grants: AtmsPluginEffectivePermissionGrantV1[];
  issued_at: string;
  expires_at: string;
}

export interface AtmsPluginToolConfirmationChallengeV1 {
  confirmation_version: 1;
  challenge_id: string;
  request_id: string;
  request_digest: string;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  effective_grants: AtmsPluginEffectivePermissionGrantV1[];
  message: string;
  issued_at: string;
  expires_at: string;
}

export interface AtmsPluginToolConfirmationDecisionV1 {
  confirmation_version: 1;
  challenge_id: string;
  request_id: string;
  request_digest: string;
  decision: "approved" | "denied";
  actor: { type: "user"; id: string };
  decided_at: string;
}

export interface AtmsPluginAuthorizedToolInvocationV1 {
  authorization_version: 1;
  invocation: AtmsPluginToolInvocationV1;
  capability: AtmsPluginToolCapabilityClaimsV1;
  confirmation?: {
    challenge: AtmsPluginToolConfirmationChallengeV1;
    decision: AtmsPluginToolConfirmationDecisionV1;
  };
}

export interface AtmsPluginRuntimeLogEntryV1 {
  sequence: number;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

/** Passive artifact reference. Runtime RPC never transports artifact bytes. */
export interface AtmsPluginRuntimeArtifactV1 {
  id: string;
  label: string;
  uri: string;
  media_type?: string;
  digest?: string;
  size_bytes?: number;
}

/** Pure prepare-phase declaration; it contains no bytes or upload authority. */
export interface AtmsPluginRuntimeArtifactDeclarationV1 {
  id: string;
  label: string;
  media_type: "application/json" | "image/jpeg" | "image/png" | "image/webp";
  digest: string;
  size_bytes: number;
}

/** Manager-issued, single-use upload authority for one prepared declaration. */
export interface AtmsPluginRuntimeArtifactUploadV1 extends AtmsPluginRuntimeArtifactDeclarationV1 {
  capability_id: string;
  upload_url: string;
  token: string;
}

export interface AtmsPluginRuntimeRpcPrepareRequestV1 {
  runtime_rpc_version: 1;
  message_type: "request";
  method: "prepare";
  rpc_id: string;
  sent_at: string;
  params: { authorization: AtmsPluginAuthorizedToolInvocationV1 };
}

export interface AtmsPluginRuntimeRpcExecuteRequestV1 {
  runtime_rpc_version: 1;
  message_type: "request";
  method: "execute";
  rpc_id: string;
  sent_at: string;
  params: {
    authorization: AtmsPluginAuthorizedToolInvocationV1;
    /** Present only after a matching pure prepare result. */
    artifact_uploads?: AtmsPluginRuntimeArtifactUploadV1[];
  };
}

export interface AtmsPluginRuntimeRpcCancelRequestV1 {
  runtime_rpc_version: 1;
  message_type: "request";
  method: "cancel";
  rpc_id: string;
  sent_at: string;
  params: {
    request_id: string;
    request_digest: string;
    reason: "user" | "deadline" | "shutdown" | "superseded";
  };
}

export interface AtmsPluginRuntimeRpcHealthRequestV1 {
  runtime_rpc_version: 1;
  message_type: "request";
  method: "health";
  rpc_id: string;
  sent_at: string;
  params: { binding: AtmsPluginToolBindingV1 };
}

export interface AtmsPluginRuntimeRpcReconcileRequestV1 {
  runtime_rpc_version: 1;
  message_type: "request";
  method: "reconcile";
  rpc_id: string;
  sent_at: string;
  params: { request_id: string; request_digest: string };
}

export type AtmsPluginRuntimeRpcRequestV1 =
  | AtmsPluginRuntimeRpcPrepareRequestV1
  | AtmsPluginRuntimeRpcExecuteRequestV1
  | AtmsPluginRuntimeRpcCancelRequestV1
  | AtmsPluginRuntimeRpcHealthRequestV1
  | AtmsPluginRuntimeRpcReconcileRequestV1;

export type AtmsPluginRuntimeExecutionOutputV1 =
  | { type: "domain_output"; output: Record<string, unknown> }
  | { type: "ui_transaction"; transaction: GenerativeUiTransactionV1 };

export interface AtmsPluginRuntimeRpcPrepareResultV1 {
  runtime_rpc_version: 1;
  message_type: "result";
  method: "prepare";
  rpc_id: string;
  completed_at: string;
  request_id: string;
  request_digest: string;
  binding: AtmsPluginToolBindingV1;
  artifact_declarations: AtmsPluginRuntimeArtifactDeclarationV1[];
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: [];
}

export interface AtmsPluginRuntimeRpcExecuteResultV1 {
  runtime_rpc_version: 1;
  message_type: "result";
  method: "execute";
  rpc_id: string;
  completed_at: string;
  request_id: string;
  request_digest: string;
  binding: AtmsPluginToolBindingV1;
  output: AtmsPluginRuntimeExecutionOutputV1;
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: AtmsPluginRuntimeArtifactV1[];
}

export interface AtmsPluginRuntimeRpcCancelResultV1 {
  runtime_rpc_version: 1;
  message_type: "result";
  method: "cancel";
  rpc_id: string;
  completed_at: string;
  request_id: string;
  request_digest: string;
  status: "accepted" | "already_finished" | "not_found";
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: AtmsPluginRuntimeArtifactV1[];
}

export interface AtmsPluginRuntimeRpcHealthResultV1 {
  runtime_rpc_version: 1;
  message_type: "result";
  method: "health";
  rpc_id: string;
  completed_at: string;
  binding: AtmsPluginToolBindingV1;
  status: "ready" | "degraded" | "unhealthy";
  runtime_api: 1;
  started_at: string;
  active_requests: number;
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: AtmsPluginRuntimeArtifactV1[];
}

export interface AtmsPluginRuntimeRpcReconcileResultV1 {
  runtime_rpc_version: 1;
  message_type: "result";
  method: "reconcile";
  rpc_id: string;
  completed_at: string;
  request_id: string;
  request_digest: string;
  binding: AtmsPluginToolBindingV1;
  status: "completed" | "absent" | "running" | "failed";
  output_digest?: string;
  output?: AtmsPluginRuntimeExecutionOutputV1;
  error?: { code: string; message: string };
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: AtmsPluginRuntimeArtifactV1[];
}

export const AtmsPluginRuntimeRpcErrorCode = {
  INVALID_REQUEST: "invalid_request",
  UNAUTHORIZED: "unauthorized",
  PERMISSION_DENIED: "permission_denied",
  CONFIRMATION_REQUIRED: "confirmation_required",
  STALE_TARGET: "stale_target",
  IDEMPOTENCY_COLLISION: "idempotency_collision",
  DEADLINE_EXCEEDED: "deadline_exceeded",
  CANCELLED: "cancelled",
  RUNTIME_UNAVAILABLE: "runtime_unavailable",
  INTERNAL: "internal",
} as const;
export type AtmsPluginRuntimeRpcErrorCode =
  (typeof AtmsPluginRuntimeRpcErrorCode)[keyof typeof AtmsPluginRuntimeRpcErrorCode];

export interface AtmsPluginRuntimeRpcErrorV1 {
  runtime_rpc_version: 1;
  message_type: "error";
  method: "prepare" | "execute" | "cancel" | "health" | "reconcile";
  rpc_id: string;
  completed_at: string;
  request_id?: string;
  request_digest?: string;
  /** Required for health errors; forbidden for execute/cancel errors. */
    binding?: AtmsPluginToolBindingV1;
  error: {
    code: AtmsPluginRuntimeRpcErrorCode;
    message: string;
    retryable: boolean;
  };
  logs: AtmsPluginRuntimeLogEntryV1[];
  artifacts: AtmsPluginRuntimeArtifactV1[];
}

export type AtmsPluginRuntimeRpcResponseV1 =
  | AtmsPluginRuntimeRpcPrepareResultV1
  | AtmsPluginRuntimeRpcExecuteResultV1
  | AtmsPluginRuntimeRpcCancelResultV1
  | AtmsPluginRuntimeRpcHealthResultV1
  | AtmsPluginRuntimeRpcReconcileResultV1
  | AtmsPluginRuntimeRpcErrorV1;

/** Expected live state supplied by Manager for stale/tamper checks. */
export interface AtmsPluginToolValidationOptionsV1 {
  now_ms?: number;
  expected?: {
    source?: AtmsPluginToolInvocationV1["source"];
    tool?: AtmsPluginToolInvocationV1["tool"];
    binding: AtmsPluginToolBindingV1;
    /** Optional manifest/broker policy snapshot for direct escalation checks. */
    policy?: AtmsPluginToolPolicyV1;
    request_id?: string;
    request_digest?: string;
  };
  idempotency_records?: ReadonlyMap<string, {
    request_id: string;
    request_digest: string;
  }>;
  consumed_capability_nonces?: ReadonlySet<string>;
}

export interface AtmsPluginCompatibilityTargetV1 {
  atms: string;
  plugin_api: number;
  ui_ir: number;
  renderer_api: number;
}

export interface AtmsPluginValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface AtmsPluginValidationResult<T> {
  valid: boolean;
  value?: T;
  errors: AtmsPluginValidationError[];
}

/**
 * Pure-data registration used by Manager and Agent UI projections. Installed
 * schemas remain registered for history even when enabled is false.
 */
export interface AtmsPluginKindRegistrationV1 {
  plugin_id: string;
  plugin_version: string;
  manifest_digest: string;
  enabled: boolean;
  schema_id: string;
  kind: string;
  kind_version: number;
  schema: Record<string, unknown>;
  allowed_surfaces: GenerativeUiSurface[];
  max_payload_bytes: number;
  fallback_required: true;
  preferred_visuals: string[];
  action_ids: string[];
}

export interface AtmsPluginRendererRegistrationV1 {
  plugin_id: string;
  plugin_version: string;
  manifest_digest: string;
  enabled: boolean;
  renderer_id: string;
  kind: string;
  kind_version: number;
  renderer_api: number;
  mode: AtmsPluginRendererMode;
  surfaces: GenerativeUiSurface[];
  devices: GenerativeUiDevice[];
  source: AtmsPluginResolvedRendererSourceV1;
  fallback: AtmsPluginRendererV1["fallback"];
}

export interface AtmsPluginUiProjectionV1 {
  registry_revision: number;
  registry_fingerprint: string;
  kinds: AtmsPluginKindRegistrationV1[];
  renderers: AtmsPluginRendererRegistrationV1[];
  /** Enabled symbolic actions. Disabled historical nodes are read-only. */
  actions: AtmsPluginActionDescriptorV1[];
}

export interface AtmsPluginToolDescriptorV1 {
  plugin_id: string;
  plugin_version: string;
  local_id: string;
  qualified_id: string;
  /** Harness-safe deterministic name, limited to 64 ASCII characters. */
  wire_id: string;
  capability_ids: string[];
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  effect: AtmsPluginEffect;
  permissions: AtmsPluginPermission[];
  confirmation: AtmsPluginConfirmation;
  handler: AtmsPluginResolvedHandlerV1;
}

export interface AtmsPluginSkillDescriptorV1 {
  plugin_id: string;
  plugin_version: string;
  local_id: string;
  qualified_id: string;
  capability_ids: string[];
  description: string;
  digest: string;
}

export interface AtmsPluginActionDescriptorV1 {
  plugin_id: string;
  plugin_version: string;
  local_id: string;
  qualified_id: string;
  capability_ids: string[];
  intent: string;
}

export interface AtmsPluginTurnContextV1 {
  context_version: 1;
  registry_revision: number;
  enabled_plugins: Array<{
    id: string;
    version: string;
    manifest_digest: string;
  }>;
  skills: AtmsPluginSkillDescriptorV1[];
  tools: AtmsPluginToolDescriptorV1[];
  actions: AtmsPluginActionDescriptorV1[];
  /** Effective grant snapshot; M3 is zero until the Permission Broker lands. */
  permission_revision: number;
  context_digest: string;
}

export interface AtmsResolvedPluginSchemaV1 {
  id: string;
  file: string;
  digest: string;
  schema: Record<string, unknown>;
}

export interface AtmsResolvedPluginSkillV1 {
  id: string;
  path: string;
  digest: string;
  content: string;
  /** Canonical normalized YAML frontmatter description for native discovery. */
  description?: string;
}

/** Immutable archive unit. Historical validation never follows package paths. */
export interface AtmsResolvedPluginDescriptorV1 {
  descriptor_version: 1;
  manifest: AtmsPluginManifestV1;
  manifest_digest: string;
  package_digest: string;
  schemas: AtmsResolvedPluginSchemaV1[];
  skills: AtmsResolvedPluginSkillV1[];
  referenced_files: Array<{
    path: string;
    digest: string;
    encoding: "base64";
    /** Exact immutable package bytes, including declarative projectors/workflows. */
    content: string;
  }>;
}
