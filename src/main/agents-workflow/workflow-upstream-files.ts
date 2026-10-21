// Saving each node's answer where the next node can read it.
//
// The prompt names a file instead of repeating the answer, so every produced value has to exist on
// disk before the run moves on. A write failure fails the run: a downstream node would otherwise be
// told to read something that is not there.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  agentsWorkflowPathSegment,
  agentsWorkflowRunAnswersDirectory,
  agentsWorkflowUpstreamRelativePath
} from '../../shared/agents-workflow-output-paths'
import { ensureAgentsWorkflowRunDirectory } from './workflow-run-scratch'

export type AgentsWorkflowAnswerWrite =
  | { ok: true; relativePath: string }
  | { ok: false; code: 'upstream_output_unavailable'; message: string }

export async function writeAgentsWorkflowNodeAnswer(input: {
  workspacePath: string
  runId: string
  nodeId: string
  content: string
}): Promise<AgentsWorkflowAnswerWrite> {
  try {
    await ensureAgentsWorkflowRunDirectory(input.workspacePath, input.runId)
    const directory = agentsWorkflowRunAnswersDirectory(input.workspacePath, input.runId)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, `${agentsWorkflowPathSegment(input.nodeId)}.md`),
      input.content,
      'utf8'
    )
  } catch (error) {
    return {
      ok: false,
      code: 'upstream_output_unavailable',
      message: `The run could not save ${input.nodeId}'s answer: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
  return { ok: true, relativePath: agentsWorkflowUpstreamRelativePath(input.runId, input.nodeId) }
}
