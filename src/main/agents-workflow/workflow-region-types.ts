// What a region of a workflow graph is executed against.

import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import type { AgentsWorkflowNodeAttempt } from '../../shared/agents-workflow-run-types'
import type { AgentsWorkflowLoopRegion } from '../../shared/agents-workflow-graph-analysis'
import type {
  AgentsWorkflowScheduleResult,
  AgentsWorkflowStepExecutor
} from './workflow-schedule-types'
import type { AgentsWorkflowRuntimeValues } from './workflow-runtime-values'
import { nextAgentsWorkflowAttempt } from './workflow-node-attempt'

export type WorkflowRegionFailure = Extract<AgentsWorkflowScheduleResult, { ok: false }>

export type WorkflowLoopContext = { loopNodeId: string; loopIteration: number }

export type WorkflowExecutionContext = {
  runId: string
  workspaceId: string
  workspacePath: string
}

export type WorkflowRegionContext = {
  definition: AgentsWorkflowDefinition
  loopRegions: readonly AgentsWorkflowLoopRegion[]
  nodesById: ReadonlyMap<string, AgentsWorkflowNode>
  attempts: AgentsWorkflowNodeAttempt[]
  executionTrace: string[]
  values: AgentsWorkflowRuntimeValues
  executeAgent: AgentsWorkflowStepExecutor
  executionContext?: WorkflowExecutionContext
  signal?: AbortSignal
  now: () => number
  checkpoint: () => Promise<void>
  /** Counts a captured answer; false once the run's output budget is spent. */
  captureOutputBytes(bytes: number): boolean
}

export function workflowRegionFailure(
  context: WorkflowRegionContext,
  code: string,
  message: string,
  options?: { cancelled?: boolean; unverifiable?: boolean }
): WorkflowRegionFailure {
  return {
    ok: false,
    code,
    message,
    ...options,
    attempts: context.attempts,
    executionTrace: context.executionTrace
  }
}

export function createWorkflowAttempt(
  context: WorkflowRegionContext,
  nodeId: string,
  status: AgentsWorkflowNodeAttempt['status'],
  loopContext?: WorkflowLoopContext
): AgentsWorkflowNodeAttempt {
  return nextAgentsWorkflowAttempt(
    context.attempts,
    nodeId,
    status,
    context.now(),
    loopContext?.loopNodeId,
    loopContext?.loopIteration
  )
}
