// Where a run keeps the answers its nodes produced.
//
// The folder lives inside the worktree so a sandboxed agent may write it, and so a downstream
// prompt can point at a file relative to the agent's own working directory. It belongs to one run
// and the whole folder is removed when that run ends; the collected values stay in run history.

import { join } from 'node:path'

export const AGENTS_WORKFLOW_OUTPUT_DIR = '.orca-workflow'

/** The engine's own copy of each answer, safe to delete once the run is over. */
export const AGENTS_WORKFLOW_ANSWERS_DIR = 'answers'

/** Device names Windows refuses as files, with or without an extension. */
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * A path segment safe on every platform; ids come from user-authored graph nodes.
 *
 * Why dots are rejected rather than kept: the segments build a folder this module later removes
 * recursively, and a value of `.` or `..` would escape the run folder.
 */
export function agentsWorkflowPathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  if (cleaned.length === 0 || /^\.+$/.test(cleaned)) {
    return 'unnamed'
  }
  return WINDOWS_RESERVED_SEGMENT.test(cleaned) ? `_${cleaned}` : cleaned
}

/** Absolute folder holding one run's answers. */
export function agentsWorkflowRunDirectory(workspacePath: string, runId: string): string {
  return join(workspacePath, AGENTS_WORKFLOW_OUTPUT_DIR, agentsWorkflowPathSegment(runId))
}

/** The answers folder of one run, absolute. Only this folder is ever removed. */
export function agentsWorkflowRunAnswersDirectory(workspacePath: string, runId: string): string {
  return join(agentsWorkflowRunDirectory(workspacePath, runId), AGENTS_WORKFLOW_ANSWERS_DIR)
}

/**
 * The iteration note for one loop turn, relative to the worktree the agent runs in. A loop body has
 * no other way to learn which turn it is on, so each iteration writes one before the body runs.
 */
export function agentsWorkflowLoopIterationRelativePath(
  runId: string,
  loopNodeId: string,
  index: number
): string {
  return [
    AGENTS_WORKFLOW_OUTPUT_DIR,
    agentsWorkflowPathSegment(runId),
    AGENTS_WORKFLOW_ANSWERS_DIR,
    `${agentsWorkflowPathSegment(loopNodeId)}.${index}.md`
  ].join('/')
}

/**
 * The answer file for one node, relative to the worktree the agent runs in. Forward slashes on
 * purpose: the value goes into a prompt, and agents read `/` on every platform.
 */
export function agentsWorkflowUpstreamRelativePath(runId: string, nodeId: string): string {
  return [
    AGENTS_WORKFLOW_OUTPUT_DIR,
    agentsWorkflowPathSegment(runId),
    AGENTS_WORKFLOW_ANSWERS_DIR,
    `${agentsWorkflowPathSegment(nodeId)}.md`
  ].join('/')
}
