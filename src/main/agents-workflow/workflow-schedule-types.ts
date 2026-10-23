// The contracts a workflow schedule offers its caller and its agent executor.

import type { TuiAgent } from '../../shared/tui-agent'
import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowNodeOutput
} from '../../shared/agents-workflow-run-types'

/**
 * The node facts an agent turn needs. A condition node runs the same turn as an agent node — it
 * just reads the answer as a yes/no decision — so executors take this shape, not the agent node.
 */
export type AgentsWorkflowAgentTurnNode = {
  id: string
  title: string
  agentId: TuiAgent
  /** The node feeds only the end node, so the channel plan may read its pane instead of a file. */
  terminal: boolean
}

export type AgentsWorkflowStepExecutor = (input: {
  runId?: string
  workspaceId?: string
  /** The worktree on disk; the file channel writes its output contract here. */
  workspacePath?: string
  node: AgentsWorkflowAgentTurnNode
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
