import { useAppStore } from '@/store'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'

/**
 * The workflow the page opens on: the one another surface asked for, else the first one. The
 * request is cleared here so it only ever applies once.
 */
export function takeRequestedAgentsWorkflow(
  workflows: readonly AgentsWorkflowDefinition[]
): AgentsWorkflowDefinition | undefined {
  const store = useAppStore.getState()
  const requestedId = store.pendingAgentsWorkflowDefinitionId
  if (!requestedId) {
    return workflows[0]
  }
  store.setPendingAgentsWorkflowDefinitionId(null)
  return workflows.find((workflow) => workflow.id === requestedId) ?? workflows[0]
}
