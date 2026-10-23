// One command node: run its shell command in the workspace and turn the output into a node value.

import { runProcess } from '@orca/process-host'
import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import { buildAgentsWorkflowCommandSpec } from '../../shared/agents-workflow-command'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from '../../shared/agents-workflow-run-limits'
import type { AgentsWorkflowNodeOutput } from '../../shared/agents-workflow-run-types'
import { saveAgentsWorkflowNodeAnswer } from './workflow-node-answer'
import {
  createWorkflowAttempt,
  workflowRegionFailure,
  type WorkflowLoopContext,
  type WorkflowRegionContext,
  type WorkflowRegionFailure
} from './workflow-region-types'

export async function runWorkflowCommandNode(
  context: WorkflowRegionContext,
  node: Extract<AgentsWorkflowNode, { kind: 'command' }>,
  loopContext?: WorkflowLoopContext
): Promise<WorkflowRegionFailure | null> {
  const attempt = createWorkflowAttempt(context, node.id, 'running', loopContext)
  context.attempts.push(attempt)
  context.executionTrace.push(node.id)
  await context.checkpoint()

  const fail = async (code: string, message: string): Promise<WorkflowRegionFailure> => {
    attempt.finishedAt = context.now()
    attempt.status = code === 'cancelled' ? 'cancelled' : 'failed'
    attempt.errorCode = code
    attempt.errorMessage = message
    await context.checkpoint()
    return workflowRegionFailure(
      context,
      code,
      message,
      code === 'cancelled' ? { cancelled: true } : {}
    )
  }

  const executionContext = context.executionContext
  if (!executionContext) {
    return await fail('workspace_unavailable', 'The command node has no workspace to run in.')
  }

  const spec = buildAgentsWorkflowCommandSpec(node.command)
  const result = await runProcess({
    program: spec.program,
    args: spec.args,
    cwd: executionContext.workspacePath,
    env: process.env,
    maxOutputBytes: AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES,
    // Why null: the run's own budget bounds the node; a 30s process default would kill real builds.
    timeoutMs: null,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    ...(context.signal ? { signal: context.signal } : {})
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))

  if (result instanceof Error) {
    return await fail('command_failed', errorMessageOf(result))
  }
  if (context.signal?.aborted) {
    return await fail('cancelled', 'Workflow run was cancelled.')
  }
  if (result.outputTruncated) {
    return await fail(
      'output_limit_exceeded',
      `The command produced more output than the ${
        AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES / 1024
      } KB a node may capture.`
    )
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    return await fail(
      'command_failed',
      `Command exited with code ${result.code ?? result.signal}.${detail ? `\n${detail}` : ''}`
    )
  }

  const content = commandOutputContent(node.command, result.stdout, result.stderr)
  const outputBytes = Buffer.byteLength(content, 'utf8')
  if (
    outputBytes > AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES ||
    !context.captureOutputBytes(outputBytes)
  ) {
    return await fail('output_limit_exceeded', 'The workflow output limit was exceeded.')
  }

  const output: AgentsWorkflowNodeOutput = {
    format: 'plain_text',
    content,
    capturedAt: context.now(),
    truncated: false,
    source: 'command_output'
  }
  attempt.output = output
  context.values.nodeOutputs.set(node.id, content)
  const saved = await saveAgentsWorkflowNodeAnswer(executionContext, node.id, content)
  if (saved !== null) {
    attempt.finishedAt = context.now()
    attempt.status = 'failed'
    attempt.errorCode = saved.code
    attempt.errorMessage = saved.message
    await context.checkpoint()
    return workflowRegionFailure(context, saved.code, saved.message)
  }
  attempt.finishedAt = context.now()
  attempt.status = 'completed'
  await context.checkpoint()
  return null
}

/** The command line plus both streams, so a reader can tell what ran and what it complained about. */
function commandOutputContent(command: string, stdout: string, stderr: string): string {
  const sections = [`$ ${command}`, stdout.trimEnd()]
  if (stderr.trim()) {
    sections.push('[stderr]', stderr.trimEnd())
  }
  return `${sections.join('\n\n')}\n`
}

function errorMessageOf(error: Error): string {
  return `The command could not be started: ${error.message}`
}
