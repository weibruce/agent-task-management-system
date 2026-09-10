import { http } from '@/api/clients/http-client'
import type { useAgentStore } from '@/stores/agent-store'
import { validateAtmsUiToolInput } from 'atms-protocol'
import {
  atmsUiWidgetRegistry,
  type AtmsUiWidgetDescriptor,
  type AtmsUiWidgetRegistry,
  type AtmsUiWidgetTarget,
} from './widget-registry'

export interface BrowserToolRunSummary {
  runId: string
  workflowId?: string
  workflowName?: string
  status: string
}

export interface AtmsUiState {
  active_surface: 'dag_status' | null
  dag_run_id: string | null
  dag_status_view: 'run_list' | 'dag_graph' | null
  widgets: AtmsUiWidgetDescriptor[]
  widgets_truncated: boolean
  ambiguous_widget_count: number
}

export interface AtmsUiSurfaceController {
  getState(): AtmsUiState
  listDagRuns(signal?: AbortSignal): Promise<BrowserToolRunSummary[]>
  openDagStatus(
    runId?: string,
    signal?: AbortSignal,
    onActionCommitted?: () => void,
  ): Promise<void>
  closeDagStatus(): void
  describeWidget(target: AtmsUiWidgetTarget): AtmsUiWidgetDescriptor
  focusWidget(
    target: AtmsUiWidgetTarget,
    onActionCommitted?: () => void,
  ): AtmsUiWidgetDescriptor
  setWidgetExpanded(
    target: AtmsUiWidgetTarget,
    expanded: boolean,
    onActionCommitted?: () => void,
  ): AtmsUiWidgetDescriptor
}

export interface AtmsUiToolExecutionContext {
  signal?: AbortSignal
  onActionCommitted?: () => void
}

export interface OpenSurfaceInput {
  surface: 'dag_status'
  entity_id?: string
  query?: string
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function searchableValues(run: BrowserToolRunSummary): string[] {
  return [run.runId, run.workflowId, run.workflowName]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(normalized)
}

export function resolveDagRunTarget(
  runs: readonly BrowserToolRunSummary[],
  input: Pick<OpenSurfaceInput, 'entity_id' | 'query'>,
): string | undefined {
  const entityId = input.entity_id?.trim()
  const query = input.query?.trim()
  if (entityId && query) throw new Error('Provide entity_id or query, not both')
  if (!entityId && !query) return undefined

  if (entityId) {
    const exact = runs.find((run) => run.runId === entityId)
    if (!exact) throw new Error(`DAG run not found: ${entityId}`)
    return exact.runId
  }

  const needle = normalized(query!)
  const exact = runs.filter((run) => searchableValues(run).includes(needle))
  if (exact.length === 1) return exact[0].runId
  if (exact.length > 1) {
    throw new Error(`DAG query is ambiguous: ${query}; matches=${exact.map((run) => run.runId).join(',')}`)
  }

  const partial = runs.filter((run) => searchableValues(run).some((value) => value.includes(needle)))
  if (partial.length === 1) return partial[0].runId
  if (partial.length > 1) {
    throw new Error(`DAG query is ambiguous: ${query}; matches=${partial.map((run) => run.runId).join(',')}`)
  }
  throw new Error(`No DAG run matches: ${query}`)
}

export async function executeAtmsUiTool(
  name: string,
  rawInput: unknown,
  controller: AtmsUiSurfaceController,
  context: AtmsUiToolExecutionContext = {},
): Promise<Record<string, unknown>> {
  if (
    name !== 'ui_get_state'
    && name !== 'ui_open_surface'
    && name !== 'ui_close_surface'
    && name !== 'ui_describe_widget'
    && name !== 'ui_focus_widget'
    && name !== 'ui_set_widget_expanded'
  ) {
    throw new Error(`Unknown Atms UI tool: ${name}`)
  }
  const input = validateAtmsUiToolInput(name, rawInput)
  const throwIfAborted = (): void => {
    if (context.signal?.aborted) {
      throw new DOMException('Atms UI tool was cancelled', 'AbortError')
    }
  }
  throwIfAborted()
  if (name === 'ui_get_state') {
    return { ok: true, state: controller.getState() }
  }

  if (
    name === 'ui_describe_widget'
    || name === 'ui_focus_widget'
    || name === 'ui_set_widget_expanded'
  ) {
    const target: AtmsUiWidgetTarget = {
      document_id: input.document_id as string,
      document_revision: input.document_revision as number,
      widget_id: input.widget_id as string,
      widget_revision: input.widget_revision as number,
    }
    const widget = name === 'ui_describe_widget'
      ? controller.describeWidget(target)
      : name === 'ui_focus_widget'
        ? (() => {
            throwIfAborted()
            return context.onActionCommitted
              ? controller.focusWidget(target, context.onActionCommitted)
              : controller.focusWidget(target)
          })()
        : (() => {
            throwIfAborted()
            const expanded = input.expanded as boolean
            return context.onActionCommitted
              ? controller.setWidgetExpanded(target, expanded, context.onActionCommitted)
              : controller.setWidgetExpanded(target, expanded)
          })()
    return { ok: true, widget }
  }

  const surface = input.surface as 'dag_status'

  if (name === 'ui_open_surface') {
    const entityId = input.entity_id as string | undefined
    const query = input.query as string | undefined
    const runs = context.signal
      ? await controller.listDagRuns(context.signal)
      : await controller.listDagRuns()
    const runId = resolveDagRunTarget(runs, {
      entity_id: entityId,
      query,
    })
    throwIfAborted()
    if (context.signal || context.onActionCommitted) {
      await controller.openDagStatus(runId, context.signal, context.onActionCommitted)
    } else {
      await controller.openDagStatus(runId)
    }
    return {
      ok: true,
      surface,
      dag_run_id: runId ?? null,
      state: controller.getState(),
    }
  }

  if (name === 'ui_close_surface') {
    throwIfAborted()
    controller.closeDagStatus()
    context.onActionCommitted?.()
    return { ok: true, surface, state: controller.getState() }
  }

  throw new Error(`Unknown Atms UI tool: ${name}`)
}

export function createAgentUiSurfaceController(
  store: ReturnType<typeof useAgentStore>,
  widgets: AtmsUiWidgetRegistry = atmsUiWidgetRegistry,
): AtmsUiSurfaceController {
  return {
    getState: () => {
      const widgetSnapshot = widgets.snapshot()
      return {
        active_surface: store.runtimeOverlayOpen ? 'dag_status' : null,
        dag_run_id: store.runtimeOverlayOpen && store.runtimeOverlayView === 'dag_graph'
          ? store.runtimeOverlayRunId ?? store.currentRunId
          : null,
        dag_status_view: store.runtimeOverlayOpen ? store.runtimeOverlayView : null,
        ...widgetSnapshot,
      }
    },
    async listDagRuns(signal) {
      const response = await http.get<{ runs?: BrowserToolRunSummary[] }>(
        '/api/runs',
        signal ? { signal } : undefined,
      )
      return Array.isArray(response.data?.runs) ? response.data.runs : []
    },
    openDagStatus: async (runId, signal, onActionCommitted) => {
      // Settings replaces the main surface in the root view. Leave it only
      // after the target opens, so success always corresponds to a visible
      // overlay while a failed direct-page invocation remains atomic.
      if (signal || onActionCommitted) {
        await store.openRuntimeOverlay(runId, signal, onActionCommitted)
      } else {
        await store.openRuntimeOverlay(runId)
      }
      if (signal?.aborted) throw new DOMException('Atms UI tool was cancelled', 'AbortError')
      store.settingsPageOpen = false
    },
    closeDagStatus: () => store.closeRuntimeOverlay(),
    describeWidget: target => widgets.describe(target),
    focusWidget: (target, onActionCommitted) => widgets.focus(target, onActionCommitted),
    setWidgetExpanded: (target, expanded, onActionCommitted) => (
      widgets.setExpanded(target, expanded, onActionCommitted)
    ),
  }
}
