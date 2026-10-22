// A condition's turn: ask its agent for a yes/no decision and settle the matching branch.
//
// The answer must be machine-readable — `{"decision":"yes"}` or `{"decision":"no"}` — because a
// guess here would send the run down a branch the author never chose. Anything else fails the node.

import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import {
  parseAgentsWorkflowDecision,
  type AgentsWorkflowDecision
} from '../../shared/agents-workflow-decision'
import { runAgentsWorkflowAgentTurn } from './workflow-agent-turn'
import {
  workflowRegionFailure,
  type WorkflowLoopContext,
  type WorkflowRegionContext,
  type WorkflowRegionFailure
} from './workflow-region-types'

export async function runWorkflowConditionNode(
  context: WorkflowRegionContext,
  node: Extract<AgentsWorkflowNode, { kind: 'condition' }>,
  loopContext?: WorkflowLoopContext
): Promise<
  { ok: true; decision: AgentsWorkflowDecision } | { ok: false; failure: WorkflowRegionFailure }
> {
  const turn = await runAgentsWorkflowAgentTurn({
    context,
    node: { ...node, terminal: false },
    source: node.prompt.source,
    ...(loopContext ? { loopContext } : {})
  })
  if (!turn.ok) {
    return { ok: false, failure: turn.failure }
  }
  const decision = parseAgentsWorkflowDecision(turn.output.content)
  if (decision === null) {
    turn.attempt.status = 'failed'
    turn.attempt.errorCode = 'condition_decision_invalid'
    turn.attempt.errorMessage =
      'The judge did not answer with {"decision":"yes"} or {"decision":"no"}.'
    await context.checkpoint()
    return {
      ok: false,
      failure: workflowRegionFailure(context, turn.attempt.errorCode, turn.attempt.errorMessage)
    }
  }
  turn.attempt.selectedBranch = decision
  await context.checkpoint()
  return { ok: true, decision }
}
