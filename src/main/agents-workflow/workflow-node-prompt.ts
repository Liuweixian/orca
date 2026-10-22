// What a node's agent receives: the loop iteration note, then the inherited answers, then the
// author's instruction. Every value a node needs is a file path, so nothing is inlined in a prompt.

import { agentsWorkflowLoopIterationRelativePath } from '../../shared/agents-workflow-output-paths'
import {
  agentsWorkflowUpstreamMarker,
  agentsWorkflowUpstreamPrompt,
  withAgentsWorkflowUpstream
} from '../../shared/agents-workflow-upstream-prompt'
import type { WorkflowLoopContext, WorkflowRegionContext } from './workflow-region-types'

/**
 * The prompt for one node turn: a loop body is told which iteration note to read first, and every
 * node is told which upstream answers to read before its own instruction.
 */
export function agentsWorkflowNodePrompt(input: {
  context: WorkflowRegionContext
  nodeId: string
  source: string
  loopContext?: WorkflowLoopContext
}): string {
  const { executionContext, values } = input.context
  const upstream = executionContext
    ? agentsWorkflowUpstreamPrompt({
        definition: input.context.definition,
        nodeId: input.nodeId,
        runId: executionContext.runId,
        hasValue: (nodeId) => values.nodeOutputs.has(nodeId) || values.loopOutputs.has(nodeId)
      })
    : null
  const loopNote =
    executionContext && input.loopContext
      ? `${agentsWorkflowUpstreamMarker(input.loopContext.loopNodeId)}\nread ${agentsWorkflowLoopIterationRelativePath(
          executionContext.runId,
          input.loopContext.loopNodeId,
          input.loopContext.loopIteration
        )} first, then`
      : null
  return withAgentsWorkflowUpstream(withAgentsWorkflowUpstream(input.source, loopNote), upstream)
}
