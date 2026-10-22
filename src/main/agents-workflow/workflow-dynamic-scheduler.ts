import { compileWorkflowGraph } from '../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import type { AgentsWorkflowNodeAttempt } from '../../shared/agents-workflow-run-types'
import {
  AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES,
  AGENTS_WORKFLOW_TERMINAL_ATTEMPT_OUTPUT_LIMIT_BYTES
} from '../../shared/agents-workflow-run-limits'
import { clampUtf8TextPrefix, isUtf8ByteLengthWithinLimit } from '../../shared/utf8-byte-limits'
import type { AgentsWorkflowRuntimeValues } from './workflow-runtime-values'
import type {
  AgentsWorkflowScheduleCheckpoint,
  AgentsWorkflowScheduleResult,
  AgentsWorkflowStepExecutor
} from './workflow-schedule-types'
import {
  createWorkflowAttempt,
  type WorkflowExecutionContext,
  type WorkflowRegionContext
} from './workflow-region-types'
import { runWorkflowRegion } from './workflow-region-runner'

export type {
  AgentsWorkflowScheduleCheckpoint,
  AgentsWorkflowScheduleResult,
  AgentsWorkflowStepExecutor
}

export async function executeAgentsWorkflowSchedule(input: {
  definition: AgentsWorkflowDefinition
  executeAgent: AgentsWorkflowStepExecutor
  now?: () => number
  signal?: AbortSignal
  executionContext?: WorkflowExecutionContext
  checkpoint?: AgentsWorkflowScheduleCheckpoint
}): Promise<AgentsWorkflowScheduleResult> {
  const compiled = compileWorkflowGraph(input.definition)
  const attempts: AgentsWorkflowNodeAttempt[] = []
  const executionTrace: string[] = []
  if (!compiled.ok) {
    return {
      ok: false,
      code: 'definition_invalid',
      message: compiled.issues.map((issue) => issue.message).join('; '),
      attempts,
      executionTrace
    }
  }

  const values: AgentsWorkflowRuntimeValues = {
    nodeOutputs: new Map(),
    loopOutputs: new Map()
  }
  let capturedOutputBytes = 0
  const context: WorkflowRegionContext = {
    definition: input.definition,
    loopRegions: compiled.graph.loopRegions,
    nodesById: new Map<string, AgentsWorkflowNode>(
      input.definition.nodes.map((node) => [node.id, node])
    ),
    attempts,
    executionTrace,
    values,
    executeAgent: input.executeAgent,
    executionContext: input.executionContext,
    signal: input.signal,
    now: input.now ?? Date.now,
    checkpoint: async () => {
      truncateAttemptOutputs(attempts)
      await input.checkpoint?.({ attempts, executionTrace })
    },
    captureOutputBytes: (bytes) => {
      capturedOutputBytes += bytes
      return capturedOutputBytes <= AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES
    }
  }

  // Why trim before every checkpoint and not at the end: checkpoints are the only writes to run
  // history, so this bounds what is stored at each step instead of leaving a full copy of every
  // answer behind on a run that later crashes. The untrimmed text already reached the next node
  // through its handoff file, so nothing downstream loses it.
  function truncateAttemptOutputs(pending: AgentsWorkflowNodeAttempt[]): void {
    for (const attempt of pending) {
      const output = attempt.output
      if (
        !output ||
        isUtf8ByteLengthWithinLimit(
          output.content,
          AGENTS_WORKFLOW_TERMINAL_ATTEMPT_OUTPUT_LIMIT_BYTES
        )
      ) {
        continue
      }
      attempt.output = {
        ...output,
        content: clampUtf8TextPrefix(
          output.content,
          AGENTS_WORKFLOW_TERMINAL_ATTEMPT_OUTPUT_LIMIT_BYTES
        ),
        truncated: true
      }
    }
  }

  const bodyNodeIds = new Set(compiled.graph.loopRegions.flatMap((region) => region.bodyNodeIds))
  const mainNodeIds = new Set(
    input.definition.nodes.map((node) => node.id).filter((nodeId) => !bodyNodeIds.has(nodeId))
  )
  const scheduleFailure = await runWorkflowRegion(
    context,
    mainNodeIds,
    new Set([compiled.graph.startNodeId])
  )
  if (scheduleFailure) {
    for (const nodeId of mainNodeIds) {
      if (
        !attempts.some((attempt) => attempt.nodeId === nodeId) &&
        nodeId !== compiled.graph.startNodeId
      ) {
        attempts.push({
          ...createWorkflowAttempt(context, nodeId, 'skipped'),
          errorCode: 'upstream_failed'
        })
      }
    }
    return scheduleFailure
  }
  return {
    ok: true,
    attempts,
    executionTrace,
    outputs: values.nodeOutputs
  }
}
