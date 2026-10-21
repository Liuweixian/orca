// One agent node's turn: render its prompt, run it, and turn the answer into a node value.

import { renderPrompt } from '../../shared/agents-workflow-graph'
import {
  agentsWorkflowUpstreamPrompt,
  withAgentsWorkflowUpstream
} from '../../shared/agents-workflow-upstream-prompt'
import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import {
  agentsWorkflowOutputIsValue,
  agentsWorkflowPromptValues,
  saveAgentsWorkflowNodeAnswer
} from './workflow-node-answer'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from './structured-agent-output-capture'
import {
  createWorkflowAttempt,
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
  const rendered = renderPrompt(node.prompt, agentsWorkflowPromptValues(context.values))
  if (!rendered.ok) {
    return workflowRegionFailure(
      context,
      'prompt_render_failed',
      `Prompt binding ${rendered.bindingKey ?? ''} failed.`
    )
  }
  const attempt = createWorkflowAttempt(context, node.id, 'running', loopContext)
  context.attempts.push(attempt)
  context.executionTrace.push(node.id)
  await context.checkpoint()

  const execution = await context
    .executeAgent({
      ...context.executionContext,
      node,
      prompt: withAgentsWorkflowUpstream(
        rendered.value,
        context.executionContext
          ? agentsWorkflowUpstreamPrompt({
              definition: context.definition,
              nodeId: node.id,
              runId: context.executionContext.runId,
              hasValue: (nodeId) =>
                context.values.nodeOutputs.has(nodeId) || context.values.loopOutputs.has(nodeId),
              prompt: node.prompt
            })
          : null
      ),
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
    return workflowRegionFailure(context, attempt.errorCode, attempt.errorMessage)
  }

  const result = execution.result
  attempt.finishedAt = context.now()
  if (!result.ok) {
    attempt.status = result.unverifiable ? 'unverifiable' : 'failed'
    attempt.errorCode = result.code
    attempt.errorMessage = result.message
    await context.checkpoint()
    return workflowRegionFailure(context, result.code, result.message, {
      unverifiable: result.unverifiable,
      ...(result.cancelled ? { cancelled: true } : {})
    })
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
    return workflowRegionFailure(context, attempt.errorCode, attempt.errorMessage)
  }
  if (node.terminal) {
    // A terminal node ends its branch: its output is run-history evidence, so no value rule
    // applies and a pane snapshot is a perfectly good record.
    attempt.status = 'completed'
    await context.checkpoint()
    return null
  }
  if (!agentsWorkflowOutputIsValue(result.output)) {
    attempt.status = 'failed'
    attempt.errorCode = 'output_untrusted'
    attempt.errorMessage = 'The agent did not produce a complete, trustworthy output.'
    await context.checkpoint()
    return workflowRegionFailure(context, attempt.errorCode, attempt.errorMessage)
  }

  attempt.status = 'completed'
  context.values.nodeOutputs.set(node.id, result.output.content)
  const saved = await saveAgentsWorkflowNodeAnswer(
    context.executionContext,
    node.id,
    result.output.content
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
