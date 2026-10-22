import type { AgentsWorkflowsChangedPayload } from '../../shared/runtime-client-events'

export type AgentsWorkflowsApi = {
  onChanged: (callback: (payload: AgentsWorkflowsChangedPayload) => void) => () => void
}
