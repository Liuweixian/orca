import type { AgentsWorkflowsChangedPayload } from '../../../shared/runtime-client-events'

export const AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT = 'orca:agents-workflows-changed'

export type AgentsWorkflowsChangedWindowDetail = AgentsWorkflowsChangedPayload & {
  environmentId?: string
}

export function emitAgentsWorkflowsChangedWindowEvent(
  detail: AgentsWorkflowsChangedWindowDetail
): void {
  window.dispatchEvent(
    new CustomEvent<AgentsWorkflowsChangedWindowDetail>(AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT, {
      detail
    })
  )
}

export function agentsWorkflowsChangedWindowDetail(
  event: Event
): AgentsWorkflowsChangedWindowDetail {
  return event instanceof CustomEvent && isDetail(event.detail) ? event.detail : {}
}

function isDetail(value: unknown): value is AgentsWorkflowsChangedWindowDetail {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const reason = 'reason' in value ? value.reason : undefined
  const environmentId = 'environmentId' in value ? value.environmentId : undefined
  return (
    (reason === undefined || reason === 'definition' || reason === 'run') &&
    (environmentId === undefined || typeof environmentId === 'string')
  )
}
