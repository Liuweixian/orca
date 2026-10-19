import {
  AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT,
  agentsWorkflowsChangedWindowDetail
} from './agents-workflows-changed-window-event'

export type AgentsWorkflowAuthority =
  | { kind: 'desktop' }
  | { kind: 'runtime'; environmentId: string }

export function subscribeAgentsWorkflowAuthorityInvalidation(
  invalidate: (authority: AgentsWorkflowAuthority) => void,
  target: EventTarget = window
): () => void {
  const pending = new Map<string, AgentsWorkflowAuthority>()
  let scheduled = false
  const flush = (): void => {
    scheduled = false
    const authorities = [...pending.values()]
    pending.clear()
    for (const authority of authorities) {
      invalidate(authority)
    }
  }
  const listener = (event: Event): void => {
    const { environmentId } = agentsWorkflowsChangedWindowDetail(event)
    const authority: AgentsWorkflowAuthority = environmentId
      ? { kind: 'runtime', environmentId }
      : { kind: 'desktop' }
    const key = authority.kind === 'desktop' ? 'desktop' : `runtime:${authority.environmentId}`
    pending.set(key, authority)
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
