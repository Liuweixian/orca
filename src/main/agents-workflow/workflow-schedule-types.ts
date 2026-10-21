// The contracts a workflow schedule offers its caller and its agent executor.

import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowNodeOutput
} from '../../shared/agents-workflow-run-types'

export type AgentsWorkflowStepExecutor = (input: {
  runId?: string
  workspaceId?: string
  /** The worktree on disk; the file channel writes its output contract here. */
  workspacePath?: string
  node: Extract<AgentsWorkflowNode, { kind: 'agent' }>
  prompt: string
  loopNodeId?: string
  loopIteration?: number
  signal?: AbortSignal
}) => Promise<
  | { ok: true; output: AgentsWorkflowNodeOutput }
  | { ok: false; code: string; message: string; unverifiable?: boolean; cancelled?: boolean }
>

export type AgentsWorkflowScheduleCheckpoint = (state: {
  attempts: readonly AgentsWorkflowNodeAttempt[]
  executionTrace: readonly string[]
}) => Promise<void>

export type AgentsWorkflowScheduleResult =
  | {
      ok: true
      attempts: AgentsWorkflowNodeAttempt[]
      executionTrace: string[]
      outputs: ReadonlyMap<string, string>
    }
  | {
      ok: false
      code: string
      message: string
      cancelled?: boolean
      unverifiable?: boolean
      attempts: AgentsWorkflowNodeAttempt[]
      executionTrace: string[]
    }
