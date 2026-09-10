// Keep `ui_get_state` comfortably below browser-tools.v1's 64 KiB result
// ceiling even when every bounded identity needs multi-byte JSON encoding.
export const ATMS_UI_WIDGET_LIST_LIMIT = 12

export type AtmsUiWidgetRenderState = 'loading' | 'settling' | 'stable' | 'error'

export interface AtmsUiWidgetTarget {
  document_id: string
  document_revision: number
  widget_id: string
  widget_revision: number
}

export interface AtmsUiWidgetDescriptor extends AtmsUiWidgetTarget {
  kind: string
  render_state: AtmsUiWidgetRenderState
  status_phase: string
  renderer_resolution: string
  placement: string
  visible: boolean
  focused: boolean
  expanded: boolean
  collapsed: boolean
  focusable: true
  expandable: true
  action_count: number
}

export interface AtmsUiWidgetSnapshot {
  widgets: AtmsUiWidgetDescriptor[]
  widgets_truncated: boolean
  ambiguous_widget_count: number
}

export interface AtmsUiWidgetRegistration {
  document_id: string
  widget_id: string
  describe(): AtmsUiWidgetDescriptor
  focus(): void
  setExpanded(expanded: boolean): void
}

interface RegisteredWidget {
  token: symbol
  documentId: string
  widgetId: string
  registration: AtmsUiWidgetRegistration
}

function exactOpaqueId(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (!value.trim() || [...value].length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must contain 1-256 printable characters`)
  }
  return value
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.trim()
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${field} must contain 1-256 printable characters`)
  }
  return normalized
}

function revision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value as number
}

function widgetKey(documentId: string, widgetId: string): string {
  return JSON.stringify([documentId, widgetId])
}

function validatedDescriptor(
  descriptor: AtmsUiWidgetDescriptor,
  expectedDocumentId: string,
  expectedWidgetId: string,
): AtmsUiWidgetDescriptor {
  const documentId = exactOpaqueId(descriptor.document_id, 'document_id')
  const widgetId = exactOpaqueId(descriptor.widget_id, 'widget_id')
  if (documentId !== expectedDocumentId || widgetId !== expectedWidgetId) {
    throw new Error('Widget registration identity changed without re-registration')
  }
  const renderState = descriptor.render_state
  if (!['loading', 'settling', 'stable', 'error'].includes(renderState)) {
    throw new Error(`Unsupported widget render state: ${String(renderState)}`)
  }
  if (!Number.isSafeInteger(descriptor.action_count) || descriptor.action_count < 0) {
    throw new Error('action_count must be a non-negative safe integer')
  }
  for (const [field, value] of [
    ['visible', descriptor.visible],
    ['focused', descriptor.focused],
    ['expanded', descriptor.expanded],
    ['collapsed', descriptor.collapsed],
  ] as const) {
    if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  }
  return {
    document_id: documentId,
    document_revision: revision(descriptor.document_revision, 'document_revision'),
    widget_id: widgetId,
    widget_revision: revision(descriptor.widget_revision, 'widget_revision'),
    kind: boundedText(descriptor.kind, 'kind'),
    render_state: renderState,
    status_phase: boundedText(descriptor.status_phase, 'status_phase'),
    renderer_resolution: boundedText(descriptor.renderer_resolution, 'renderer_resolution'),
    placement: boundedText(descriptor.placement, 'placement'),
    visible: descriptor.visible,
    focused: descriptor.focused,
    expanded: descriptor.expanded,
    collapsed: descriptor.collapsed,
    focusable: true,
    expandable: true,
    action_count: descriptor.action_count,
  }
}

function assertExactRevision(
  target: AtmsUiWidgetTarget,
  descriptor: AtmsUiWidgetDescriptor,
): void {
  if (
    descriptor.document_revision !== target.document_revision
    || descriptor.widget_revision !== target.widget_revision
  ) {
    throw new Error([
      `Widget revision is stale: ${target.document_id}/${target.widget_id}`,
      `requested=${target.document_revision}:${target.widget_revision}`,
      `current=${descriptor.document_revision}:${descriptor.widget_revision}`,
    ].join('; '))
  }
}

/**
 * Renderer-local registry for trusted host-owned Generative UI widgets.
 *
 * The model can address only canonical IDs exposed by `snapshot()`. Duplicate
 * live registrations are treated as ambiguous and cannot be operated. No DOM
 * selector or coordinate crosses this boundary.
 */
export class AtmsUiWidgetRegistry {
  readonly #registrations = new Map<string, RegisteredWidget[]>()

  register(registration: AtmsUiWidgetRegistration): () => void {
    const documentId = exactOpaqueId(registration.document_id, 'document_id')
    const widgetId = exactOpaqueId(registration.widget_id, 'widget_id')
    validatedDescriptor(registration.describe(), documentId, widgetId)
    const key = widgetKey(documentId, widgetId)
    const entry = { token: Symbol(key), documentId, widgetId, registration }
    this.#registrations.set(key, [...(this.#registrations.get(key) ?? []), entry])
    return () => {
      const remaining = (this.#registrations.get(key) ?? [])
        .filter(candidate => candidate.token !== entry.token)
      if (remaining.length) this.#registrations.set(key, remaining)
      else this.#registrations.delete(key)
    }
  }

  snapshot(limit = ATMS_UI_WIDGET_LIST_LIMIT): AtmsUiWidgetSnapshot {
    const boundedLimit = Number.isSafeInteger(limit) && limit >= 0
      ? Math.min(limit, ATMS_UI_WIDGET_LIST_LIMIT)
      : ATMS_UI_WIDGET_LIST_LIMIT
    const widgets: AtmsUiWidgetDescriptor[] = []
    let ambiguousWidgetCount = 0
    let validUniqueWidgetCount = 0
    const keys = [...this.#registrations.keys()].sort()
    for (const key of keys) {
      const entries = this.#registrations.get(key) ?? []
      if (entries.length !== 1) {
        ambiguousWidgetCount += 1
        continue
      }
      const entry = entries[0]!
      try {
        const descriptor = validatedDescriptor(
          entry.registration.describe(),
          entry.documentId,
          entry.widgetId,
        )
        validUniqueWidgetCount += 1
        if (widgets.length < boundedLimit) widgets.push(descriptor)
      } catch {
        // A malformed or transient registration is not exposed to an Agent.
      }
    }
    return {
      widgets,
      widgets_truncated: validUniqueWidgetCount > widgets.length,
      ambiguous_widget_count: ambiguousWidgetCount,
    }
  }

  describe(target: AtmsUiWidgetTarget): AtmsUiWidgetDescriptor {
    return this.#resolve(target).descriptor
  }

  focus(
    target: AtmsUiWidgetTarget,
    onActionCommitted?: () => void,
  ): AtmsUiWidgetDescriptor {
    const { entry, descriptor } = this.#resolve(target)
    if (!descriptor.visible) throw new Error('Widget is not currently visible')
    entry.registration.focus()
    onActionCommitted?.()
    const current = this.#describeCurrent(entry)
    assertExactRevision(target, current)
    if (!current.focused) throw new Error('Widget did not accept focus')
    return current
  }

  setExpanded(
    target: AtmsUiWidgetTarget,
    expanded: boolean,
    onActionCommitted?: () => void,
  ): AtmsUiWidgetDescriptor {
    if (typeof expanded !== 'boolean') throw new Error('expanded must be a boolean')
    const { entry, descriptor } = this.#resolve(target)
    if (!descriptor.visible) throw new Error('Widget is not currently visible')
    entry.registration.setExpanded(expanded)
    onActionCommitted?.()
    const current = this.#describeCurrent(entry)
    assertExactRevision(target, current)
    if (current.expanded !== expanded) throw new Error('Widget expansion state did not change')
    return current
  }

  clear(): void {
    this.#registrations.clear()
  }

  #describeCurrent(entry: RegisteredWidget): AtmsUiWidgetDescriptor {
    return validatedDescriptor(
      entry.registration.describe(),
      entry.documentId,
      entry.widgetId,
    )
  }

  #resolve(target: AtmsUiWidgetTarget): {
    entry: RegisteredWidget
    descriptor: AtmsUiWidgetDescriptor
  } {
    const documentId = exactOpaqueId(target.document_id, 'document_id')
    const widgetId = exactOpaqueId(target.widget_id, 'widget_id')
    const entries = this.#registrations.get(widgetKey(documentId, widgetId)) ?? []
    if (!entries.length) throw new Error(`Widget is not currently rendered: ${documentId}/${widgetId}`)
    if (entries.length !== 1) throw new Error(`Widget identity is ambiguous: ${documentId}/${widgetId}`)
    const entry = entries[0]!
    const descriptor = this.#describeCurrent(entry)
    assertExactRevision({
      document_id: documentId,
      document_revision: revision(target.document_revision, 'document_revision'),
      widget_id: widgetId,
      widget_revision: revision(target.widget_revision, 'widget_revision'),
    }, descriptor)
    return { entry, descriptor }
  }
}

export const atmsUiWidgetRegistry = new AtmsUiWidgetRegistry()
