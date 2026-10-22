// One agent turn for a workflow node: run the prompt, settle the attempt, and enforce the output
// budget. Agent nodes and condition judges share it; what differs is what they do with the answer.

import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowNodeOutput
} from '../../shared/agents-workflow-run-types'
import type { AgentsWorkflowAgentTurnNode } from './workflow-schedule-types'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from '../../shared/agents-workflow-run-limits'
import {
  createWorkflowAttempt,
  workflowRegionFailure,
  type WorkflowLoopContext,
  type WorkflowRegionContext,
  type WorkflowRegionFailure
} from './workflow-region-types'
import { agentsWorkflowNodePrompt } from './workflow-node-prompt'

export type AgentsWorkflowAgentTurnResult =
  | { ok: true; attempt: AgentsWorkflowNodeAttempt; output: AgentsWorkflowNodeOutput }
  | { ok: false; failure: WorkflowRegionFailure }

export async function runAgentsWorkflowAgentTurn(input: {
  context: WorkflowRegionContext
  node: AgentsWorkflowAgentTurnNode
  source: string
  loopContext?: WorkflowLoopContext
}): Promise<AgentsWorkflowAgentTurnResult> {
  const { context, node, loopContext } = input
  const attempt = createWorkflowAttempt(context, node.id, 'running', loopContext)
  context.attempts.push(attempt)
  context.executionTrace.push(node.id)
  await context.checkpoint()

  const execution = await context
    .executeAgent({
      ...context.executionContext,
      node,
      prompt: agentsWorkflowNodePrompt({
        context,
        nodeId: node.id,
        source: input.source,
        ...(loopContext ? { loopContext } : {})
      }),
      loopNodeId: loopContext?.loopNodeId,
      loopIteration: loopContext?.loopIteration,
      signal: context.signal
    })
    .then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error })
    )

  if (!execution.ok) {
    // Why: an executor that throws (a pane closed or a transport dropped) must still settle its
    // attempt. Leaving it `running` made the run's failure unreadable, and the throw escaped to
    // the run service as a generic `workflow_execution_failed`.
    attempt.finishedAt = context.now()
    attempt.status = 'failed'
    attempt.errorCode = 'agent_turn_failed'
    attempt.errorMessage =
      execution.error instanceof Error ? execution.error.message : 'The agent turn failed.'
    await context.checkpoint()
    return {
      ok: false,
      failure: workflowRegionFailure(context, attempt.errorCode, attempt.errorMessage)
    }
  }

  const result = execution.result
  attempt.finishedAt = context.now()
  if (!result.ok) {
    attempt.status = result.unverifiable ? 'unverifiable' : 'failed'
    attempt.errorCode = result.code
    attempt.errorMessage = result.message
    await context.checkpoint()
    return {
      ok: false,
      failure: workflowRegionFailure(context, result.code, result.message, {
        unverifiable: result.unverifiable,
        ...(result.cancelled ? { cancelled: true } : {})
      })
    }
  }

  attempt.output = result.output
  const outputBytes = Buffer.byteLength(result.output.content, 'utf8')
  if (
    outputBytes > AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES ||
    !context.captureOutputBytes(outputBytes)
  ) {
    attempt.status = 'failed'
    attempt.errorCode = 'output_limit_exceeded'
    attempt.errorMessage = 'The workflow output limit was exceeded.'
    await context.checkpoint()
    return {
      ok: false,
      failure: workflowRegionFailure(context, attempt.errorCode, attempt.errorMessage)
    }
  }

  attempt.status = 'completed'
  await context.checkpoint()
  return { ok: true, attempt, output: result.output }
}
