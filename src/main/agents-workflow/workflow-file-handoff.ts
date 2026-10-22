// The output contract a node's prompt carries, and the file it must produce.
//
// Why a file instead of the pane's text: only a few agents speak a structured protocol, and screen
// text is chrome mixed with prose. Every agent can write a file, so the run asks for one explicit
// artifact and reads it back. The contract lives beside the prompt, never inside it.

import { join } from 'node:path'
import {
  agentsWorkflowPathSegment,
  agentsWorkflowRunDirectory
} from '../../shared/agents-workflow-output-paths'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from '../../shared/agents-workflow-run-limits'

export const AGENTS_WORKFLOW_OUTPUT_CONTRACT_MARKER = '<!-- orca:workflow-output -->'

export type AgentsWorkflowHandoffFailure =
  | 'output_contract_missing'
  | 'output_contract_empty'
  | 'output_contract_too_large'

export type AgentsWorkflowHandoffRead =
  | { ok: true; content: string }
  | { ok: false; code: AgentsWorkflowHandoffFailure; message: string }

/** The run's scratch folder, shared with the answers saved for downstream nodes. */
function agentsWorkflowHandoffDirectory(workspacePath: string, runId: string): string {
  return agentsWorkflowRunDirectory(workspacePath, runId)
}

export function agentsWorkflowHandoffPath(input: {
  workspacePath: string
  runId: string
  nodeId: string
  attempt: string
}): string {
  return join(
    agentsWorkflowHandoffDirectory(input.workspacePath, input.runId),
    `${agentsWorkflowPathSegment(input.nodeId)}-${agentsWorkflowPathSegment(input.attempt)}.md`
  )
}

export function withAgentsWorkflowOutputContract(prompt: string, outputPath: string): string {
  return [
    prompt,
    '',
    AGENTS_WORKFLOW_OUTPUT_CONTRACT_MARKER,
    'When this task is finished, write your final answer for the next workflow step to:',
    outputPath,
    'Write it as Markdown. Change no other file.'
  ].join('\n')
}

export function agentsWorkflowHandoffTooLarge(): AgentsWorkflowHandoffRead {
  return {
    ok: false,
    code: 'output_contract_too_large',
    message: 'The output file is larger than a workflow value may be.'
  }
}

/** True when a file of this size may not be read as a workflow value at all. */
export function agentsWorkflowHandoffByteLimitExceeded(byteLength: number): boolean {
  return byteLength > AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES
}

export function parseAgentsWorkflowHandoff(raw: string): AgentsWorkflowHandoffRead {
  if (agentsWorkflowHandoffByteLimitExceeded(Buffer.byteLength(raw, 'utf8'))) {
    return agentsWorkflowHandoffTooLarge()
  }
  const content = raw.trim()
  if (content.length === 0) {
    // An empty file is what a half-written answer looks like; the wait retries before failing.
    return {
      ok: false,
      code: 'output_contract_empty',
      message: 'The output file is empty.'
    }
  }
  return { ok: true, content }
}
