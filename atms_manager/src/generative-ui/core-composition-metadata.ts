import type { GenerativeUiKindCompositionMetadataV1 } from "./surface-composer.js";

/** Static M2 bridge metadata. M3 replaces this with the installed Kind Registry. */
export const CORE_GENERATIVE_UI_COMPOSITION_METADATA: readonly GenerativeUiKindCompositionMetadataV1[] = [
  { kind: "com.atms.core/task_summary", kind_version: 1, allowed_surfaces: ["task"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/notice", kind_version: 1, allowed_surfaces: ["task", "ambient"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/checklist", kind_version: 1, allowed_surfaces: ["task"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/execution_progress", kind_version: 1, allowed_surfaces: ["execution"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/execution_graph", kind_version: 1, allowed_surfaces: ["execution"], default_variant: "detail", allow_critical: true },
  { kind: "com.atms.core/timeline", kind_version: 1, allowed_surfaces: ["execution"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/metric_set", kind_version: 1, allowed_surfaces: ["ambient", "result"], default_variant: "glance", allow_critical: true },
  { kind: "com.atms.core/artifact", kind_version: 1, allowed_surfaces: ["result"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/confirmation", kind_version: 1, allowed_surfaces: ["task"], default_variant: "summary", allow_critical: true },
  { kind: "com.atms.core/generated_view", kind_version: 2, allowed_surfaces: ["task", "execution", "result", "ambient"], default_variant: "detail", allow_critical: true },
  { kind: "com.atms.content/topic_outline", kind_version: 1, allowed_surfaces: ["task"], default_variant: "detail" },
  { kind: "com.atms.content/xiaohongshu_note", kind_version: 1, allowed_surfaces: ["result"], default_variant: "detail" },
  { kind: "com.atms.presentation/slide_deck", kind_version: 1, allowed_surfaces: ["result"], default_variant: "detail" },
  { kind: "com.atms.legacy/rich_content", kind_version: 1, allowed_surfaces: ["result"], default_variant: "detail" },
  { kind: "com.atms.legacy/widget", kind_version: 1, allowed_surfaces: ["ambient"], default_variant: "summary" },
];
