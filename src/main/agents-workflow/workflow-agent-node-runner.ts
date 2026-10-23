// One agent node's turn: run its prompt and turn the answer into a node value.

import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import { agentsWorkflowNodeFeedsEnd } from '../../shared/agents-workflow-graph-analysis'
import { agentsWorkflowOutputIsValue, saveAgentsWorkflowNodeAnswer } from './workflow-node-answer'
import { runAgentsWorkflowAgentTurn } from './workflow-agent-turn'
import {
  workflowRegionFailure,
  type WorkflowLoopContext,
  type WorkflowRegionContext,
  type WorkflowRegionFailure
} from './workflow-region-types'

export async function runWorkflowAgentNode(
  context: WorkflowRegionContext,
  node: Extract<AgentsWorkflowNode, { kind: 'agent' }>,
  loopContext?: WorkflowLoopContext
): Promise<WorkflowRegionFailure | null> {
  const terminal = agentsWorkflowNodeFeedsEnd(context.definition, node.id)
  const turn = await runAgentsWorkflowAgentTurn({
    context,
    node: { ...node, terminal },
    source: node.prompt.source,
    ...(loopContext ? { loopContext } : {})
  })
  if (!turn.ok) {
    return turn.failure
  }
  const { attempt } = turn
  if (terminal) {
    // The node's only successor is end: its answer is run-history evidence, so no value rule
    // applies and a pane snapshot is a perfectly good record.
    return null
  }
  if (!agentsWorkflowOutputIsValue(turn.output)) {
    attempt.status = 'failed'
    attempt.errorCode = 'output_untrusted'
    attempt.errorMessage = 'The agent did not produce a complete, trustworthy output.'
    await context.checkpoint()
    return workflowRegionFailure(
      context,
      'output_untrusted',
      'The agent did not produce a complete, trustworthy output.'
    )
  }
  context.values.nodeOutputs.set(node.id, turn.output.content)
  const saved = await saveAgentsWorkflowNodeAnswer(
    context.executionContext,
    node.id,
    turn.output.content
  )
  if (saved !== null) {
    attempt.status = 'failed'
    attempt.errorCode = saved.code
    attempt.errorMessage = saved.message
    await context.checkpoint()
    return workflowRegionFailure(context, saved.code, saved.message)
  }
  await context.checkpoint()
  return null
}
