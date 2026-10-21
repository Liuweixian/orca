import React from 'react'
import { subscribeAgentsWorkflowAuthorityInvalidation } from '@/lib/agents-workflow-authority-invalidation'

type AgentsWorkflowInvalidationTargets = {
  definitionId: string | null
  selectedRunId: string | null
  refreshList: () => Promise<unknown>
  refreshRuns: (workflowId: string) => Promise<void>
  reloadRun: (runId: string) => Promise<unknown>
}

/**
 * Refreshes what the host actually changed. Why not everything on every event: a run checkpoints
 * after each node, so re-reading the definition list on each of those is pure waste.
 */
export function useAgentsWorkflowInvalidation(targets: AgentsWorkflowInvalidationTargets): void {
  const latest = React.useRef(targets)
  latest.current = targets
  const { refreshList, refreshRuns, reloadRun } = targets

  React.useEffect(() => {
    return subscribeAgentsWorkflowAuthorityInvalidation(({ authority, reason }) => {
      if (authority.kind !== 'desktop') {
        return
      }
      const { definitionId, selectedRunId } = latest.current
      if (reason === 'run') {
        if (definitionId) {
          void refreshRuns(definitionId)
        }
        if (selectedRunId) {
          void reloadRun(selectedRunId)
        }
        return
      }
      void refreshList()
      // A definition change does not touch run history; an older host's bare event refreshes both.
      if (reason === undefined) {
        if (definitionId) {
          void refreshRuns(definitionId)
        }
        if (selectedRunId) {
          void reloadRun(selectedRunId)
        }
      }
    })
  }, [refreshList, refreshRuns, reloadRun])
}
