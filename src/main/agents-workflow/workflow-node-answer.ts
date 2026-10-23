// Turning a completed node output into a value the next node may bind.
//
// Screen text is evidence, never a value, and a truncated answer is not the answer. A value is also
// written to the run's answer folder so a downstream prompt can point the agent at the file.

import type { AgentsWorkflowNodeOutput } from '../../shared/agents-workflow-run-types'
import { writeAgentsWorkflowNodeAnswer } from './workflow-upstream-files'

/** Outputs a downstream node may bind. */
const AGENTS_WORKFLOW_VALUE_OUTPUT_SOURCES: ReadonlySet<AgentsWorkflowNodeOutput['source']> =
  new Set([
    'structured_assistant_message',
    'agent_transcript',
    'agent_file_handoff',
    'command_output'
  ])

export function agentsWorkflowOutputIsValue(output: AgentsWorkflowNodeOutput): boolean {
  return !output.truncated && AGENTS_WORKFLOW_VALUE_OUTPUT_SOURCES.has(output.source)
}

/** Writes an answer for the next node to read; null when the run has no workspace to write into. */
export async function saveAgentsWorkflowNodeAnswer(
  context: { runId: string; workspacePath: string } | undefined,
  nodeId: string,
  content: string
): Promise<{ code: string; message: string } | null> {
  if (!context) {
    return null
  }
  const written = await writeAgentsWorkflowNodeAnswer({
    workspacePath: context.workspacePath,
    runId: context.runId,
    nodeId,
    content
  })
  return written.ok ? null : { code: written.code, message: written.message }
}
