// One node's attempt record. The id stays unique per run by counting what already ran.

import type { AgentsWorkflowNodeAttempt } from '../../shared/agents-workflow-run-types'

export function nextAgentsWorkflowAttempt(
  attempts: readonly AgentsWorkflowNodeAttempt[],
  nodeId: string,
  status: AgentsWorkflowNodeAttempt['status'],
  now: number,
  loopNodeId?: string,
  loopIteration?: number
): AgentsWorkflowNodeAttempt {
  return {
    id: `${nodeId}:${attempts.length + 1}`,
    nodeId,
    status,
    ...(loopNodeId === undefined ? {} : { loopNodeId }),
    ...(loopIteration === undefined ? {} : { loopIteration }),
    startedAt: status === 'skipped' ? null : now,
    finishedAt: status === 'running' || status === 'pending' ? null : now,
    output: null
  }
}
