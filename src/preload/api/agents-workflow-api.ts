import type { AgentsWorkflowsChangedPayload } from '../../shared/remote-runtime/session-graph/runtime-client-events'

export type AgentsWorkflowsApi = {
  onChanged: (callback: (payload: AgentsWorkflowsChangedPayload) => void) => () => void
}
