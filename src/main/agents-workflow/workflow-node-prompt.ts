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
  const loopContext = input.loopContext
  const loopNote =
    executionContext && loopContext
      ? `${agentsWorkflowUpstreamMarker(loopContext.loopNodeId)}\nread ${agentsWorkflowLoopIterationRelativePath(
          executionContext.runId,
          loopContext.loopNodeId,
          loopContext.loopIteration
        )} first (loop "${
          input.context.nodesById.get(loopContext.loopNodeId)?.title.trim() ||
          loopContext.loopNodeId
        }" turn ${loopContext.loopIteration + 1}), then`
      : null
  return withAgentsWorkflowUpstream(withAgentsWorkflowUpstream(input.source, loopNote), upstream)
}
