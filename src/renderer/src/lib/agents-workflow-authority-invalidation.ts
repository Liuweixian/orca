import {
  AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT,
  agentsWorkflowsChangedWindowDetail
} from './agents-workflows-changed-window-event'

export type AgentsWorkflowAuthority =
  | { kind: 'desktop' }
  | { kind: 'runtime'; environmentId: string }

/** What changed: a run, a definition, or an older host that does not say. */
export type AgentsWorkflowChangeReason = 'definition' | 'run' | undefined

export type AgentsWorkflowInvalidation = {
  authority: AgentsWorkflowAuthority
  reason: AgentsWorkflowChangeReason
}

export function subscribeAgentsWorkflowAuthorityInvalidation(
  invalidate: (invalidation: AgentsWorkflowInvalidation) => void,
  target: EventTarget = window
): () => void {
  const pending = new Map<string, AgentsWorkflowInvalidation>()
  let scheduled = false
  const flush = (): void => {
    scheduled = false
    const invalidations = [...pending.values()]
    pending.clear()
    for (const invalidation of invalidations) {
      invalidate(invalidation)
    }
  }
  const listener = (event: Event): void => {
    const { environmentId, reason } = agentsWorkflowsChangedWindowDetail(event)
    const authority: AgentsWorkflowAuthority = environmentId
      ? { kind: 'runtime', environmentId }
      : { kind: 'desktop' }
    const key = authority.kind === 'desktop' ? 'desktop' : `runtime:${authority.environmentId}`
    const existing = pending.get(key)
    pending.set(key, {
      authority,
      // Why: a burst of run checkpoints must not also make the renderer re-read the definition
      // list; an unknown reason (older host) still refreshes everything.
      reason: existing === undefined ? reason : mergeReasons(existing.reason, reason)
    })
    if (!scheduled) {
      scheduled = true
      queueMicrotask(flush)
    }
  }
  target.addEventListener(AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT, listener)
  return () => {
    target.removeEventListener(AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT, listener)
    pending.clear()
  }
}

function mergeReasons(
  left: AgentsWorkflowChangeReason,
  right: AgentsWorkflowChangeReason
): AgentsWorkflowChangeReason {
  if (left === undefined || right === undefined) {
    return undefined
  }
  return left === 'definition' || right === 'definition' ? 'definition' : 'run'
}
