import type { RuntimeClientEvent } from '../../../shared/runtime-client-events'
import { emitAgentsWorkflowsChangedWindowEvent } from './agents-workflows-changed-window-event'
import { emitAutomationsChangedWindowEvent } from './automations-changed-window-event'

/**
 * Re-broadcast a host's automation and workflow changes to window listeners.
 * Returns true when the event was consumed, so the IPC bridge stays a routing table.
 */
export function forwardAgentSurfaceChangeEvents(
  event: RuntimeClientEvent,
  environmentId: string
): boolean {
  if (event.type === 'automationsChanged') {
    // Why: without the environment the subscriber cannot attribute the changed authority.
    emitAutomationsChangedWindowEvent({
      environmentId,
      ...(event.selector ? { selector: event.selector } : {}),
      ...(event.reason ? { reason: event.reason } : {})
    })
    return true
  }
  if (event.type === 'agentsWorkflowsChanged') {
    emitAgentsWorkflowsChangedWindowEvent({
      environmentId,
      ...(event.reason ? { reason: event.reason } : {})
    })
    return true
  }
  return false
}
