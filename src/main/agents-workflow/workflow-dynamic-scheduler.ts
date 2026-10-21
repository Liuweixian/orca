import { compileWorkflowGraph, renderPrompt } from '../../shared/agents-workflow-graph'
import {
  agentsWorkflowUpstreamPrompt,
  withAgentsWorkflowUpstream
} from '../../shared/agents-workflow-upstream-prompt'
import {
  agentsWorkflowOutputIsValue,
  agentsWorkflowPromptValues,
  saveAgentsWorkflowNodeAnswer
} from './workflow-node-answer'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import type { AgentsWorkflowNodeAttempt } from '../../shared/agents-workflow-run-types'
import {
  evaluateAgentsWorkflowCondition,
  resolveAgentsWorkflowLoopItems,
  resolveAgentsWorkflowVariable,
  type AgentsWorkflowRuntimeValues
} from './workflow-runtime-values'
import { nextAgentsWorkflowAttempt } from './workflow-node-attempt'
import type {
  AgentsWorkflowScheduleCheckpoint,
  AgentsWorkflowScheduleResult,
  AgentsWorkflowStepExecutor
} from './workflow-schedule-types'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from './structured-agent-output-capture'

const AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES = 20 * 1024 * 1024

export type {
  AgentsWorkflowScheduleCheckpoint,
  AgentsWorkflowScheduleResult,
  AgentsWorkflowStepExecutor
}

type ExecutionFailure = Extract<AgentsWorkflowScheduleResult, { ok: false }>
type EdgeState = 'pending' | 'active' | 'inactive'

export async function executeAgentsWorkflowSchedule(input: {
  definition: AgentsWorkflowDefinition
  runInput: string
  executeAgent: AgentsWorkflowStepExecutor
  now?: () => number
  signal?: AbortSignal
  executionContext?: { runId: string; workspaceId: string; workspacePath: string }
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

  const now = input.now ?? Date.now
  const nodesById = new Map(input.definition.nodes.map((node) => [node.id, node]))
  const bodyNodeIds = new Set(compiled.graph.loopRegions.flatMap((region) => region.bodyNodeIds))
  const values: AgentsWorkflowRuntimeValues = {
    runInput: input.runInput,
    nodeOutputs: new Map(),
    loopItems: new Map(),
    loopIndexes: new Map(),
    loopOutputs: new Map()
  }
  let capturedOutputBytes = 0
  const checkpoint = async (): Promise<void> => {
    await input.checkpoint?.({ attempts, executionTrace })
  }

  const failure = (
    code: string,
    message: string,
    options?: { cancelled?: boolean; unverifiable?: boolean }
  ): ExecutionFailure => ({
    ok: false,
    code,
    message,
    ...options,
    attempts,
    executionTrace
  })

  const createAttempt = (
    nodeId: string,
    status: AgentsWorkflowNodeAttempt['status'],
    loopNodeId?: string,
    loopIteration?: number
  ): AgentsWorkflowNodeAttempt =>
    nextAgentsWorkflowAttempt(attempts, nodeId, status, now(), loopNodeId, loopIteration)

  const runRegion = async (
    allowedNodeIds: ReadonlySet<string>,
    rootNodeIds: ReadonlySet<string>,
    loopContext?: { loopNodeId: string; loopIteration: number }
  ): Promise<ExecutionFailure | null> => {
    const relevantEdges = input.definition.edges.filter(
      (edge) =>
        edge.toPort !== 'aggregate' &&
        allowedNodeIds.has(edge.fromNodeId) &&
        allowedNodeIds.has(edge.toNodeId)
    )
    const edgeStates = new Map<string, EdgeState>(relevantEdges.map((edge) => [edge.id, 'pending']))
    const settledNodes = new Set<string>()

    const outgoing = (nodeId: string): AgentsWorkflowEdge[] =>
      relevantEdges.filter((edge) => edge.fromNodeId === nodeId)
    const incoming = (nodeId: string): AgentsWorkflowEdge[] =>
      relevantEdges.filter((edge) => edge.toNodeId === nodeId)
    const settleEdges = (nodeId: string, active: (edge: AgentsWorkflowEdge) => boolean): void => {
      for (const edge of outgoing(nodeId)) {
        edgeStates.set(edge.id, active(edge) ? 'active' : 'inactive')
      }
    }

    const skipNode = (node: AgentsWorkflowNode): void => {
      settledNodes.add(node.id)
      settleEdges(node.id, () => false)
      attempts.push({
        ...createAttempt(node.id, 'skipped', loopContext?.loopNodeId, loopContext?.loopIteration),
        errorCode: 'condition_not_selected'
      })
    }

    const runAgent = async (
      node: Extract<AgentsWorkflowNode, { kind: 'agent' }>
    ): Promise<ExecutionFailure | null> => {
      const rendered = renderPrompt(node.prompt, agentsWorkflowPromptValues(values))
      if (!rendered.ok) {
        return failure(
          'prompt_render_failed',
          `Prompt binding ${rendered.bindingKey ?? ''} failed.`
        )
      }
      const attempt = createAttempt(
        node.id,
        'running',
        loopContext?.loopNodeId,
        loopContext?.loopIteration
      )
      attempts.push(attempt)
      executionTrace.push(node.id)
      await checkpoint()
      const execution = await input
        .executeAgent({
          ...input.executionContext,
          node,
          prompt: withAgentsWorkflowUpstream(
            rendered.value,
            input.executionContext
              ? agentsWorkflowUpstreamPrompt({
                  definition: input.definition,
                  nodeId: node.id,
                  runId: input.executionContext.runId,
                  hasValue: (nodeId) =>
                    values.nodeOutputs.has(nodeId) || values.loopOutputs.has(nodeId),
                  prompt: node.prompt
                })
              : null
          ),
          loopNodeId: loopContext?.loopNodeId,
          loopIteration: loopContext?.loopIteration,
          signal: input.signal
        })
        .then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error })
        )
      if (!execution.ok) {
        // Why: an executor that throws (a pane closed or a transport dropped) must still settle its
        // attempt. Leaving it `running` made the run's failure unreadable, and the throw escaped to
        // the run service as a generic `workflow_execution_failed`.
        attempt.finishedAt = now()
        attempt.status = 'failed'
        attempt.errorCode = 'agent_turn_failed'
        attempt.errorMessage =
          execution.error instanceof Error ? execution.error.message : 'The agent turn failed.'
        await checkpoint()
        return failure(attempt.errorCode, attempt.errorMessage)
      }
      const result = execution.result
      attempt.finishedAt = now()
      if (!result.ok) {
        attempt.status = result.unverifiable ? 'unverifiable' : 'failed'
        attempt.errorCode = result.code
        attempt.errorMessage = result.message
        await checkpoint()
        return failure(result.code, result.message, { unverifiable: result.unverifiable })
      }
      attempt.output = result.output
      const outputBytes = Buffer.byteLength(result.output.content, 'utf8')
      capturedOutputBytes += outputBytes
      if (
        outputBytes > AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES ||
        capturedOutputBytes > AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES
      ) {
        attempt.status = 'failed'
        attempt.errorCode = 'output_limit_exceeded'
        attempt.errorMessage = 'The workflow output limit was exceeded.'
        await checkpoint()
        return failure(attempt.errorCode, attempt.errorMessage)
      }
      if (node.terminal) {
        // A terminal node ends its branch: its output is run-history evidence, so no value rule
        // applies and a pane snapshot is a perfectly good record.
        attempt.status = 'completed'
        await checkpoint()
        return null
      }
      if (!agentsWorkflowOutputIsValue(result.output)) {
        attempt.status = 'failed'
        attempt.errorCode = 'output_untrusted'
        attempt.errorMessage = 'The agent did not produce a complete, trustworthy output.'
        await checkpoint()
        return failure(attempt.errorCode, attempt.errorMessage)
      }
      attempt.status = 'completed'
      values.nodeOutputs.set(node.id, result.output.content)
      const saved = await saveAgentsWorkflowNodeAnswer(
        input.executionContext,
        node.id,
        result.output.content
      )
      if (saved !== null) {
        attempt.status = 'failed'
        attempt.errorCode = saved.code
        attempt.errorMessage = saved.message
        await checkpoint()
        return failure(saved.code, saved.message)
      }
      await checkpoint()
      return null
    }

    const runLoop = async (
      node: Extract<AgentsWorkflowNode, { kind: 'loop' }>
    ): Promise<ExecutionFailure | null> => {
      const region = compiled.graph.loopRegions.find((entry) => entry.loopNodeId === node.id)
      if (!region) {
        return failure('loop_region_missing', `Loop region ${node.id} is unavailable.`)
      }
      const resolved = resolveAgentsWorkflowLoopItems(node, values)
      if (!resolved.ok) {
        return failure(resolved.code, resolved.message)
      }
      const outputs: string[] = []
      for (const [index, item] of resolved.items.entries()) {
        if (input.signal?.aborted) {
          return failure('cancelled', 'Workflow run was cancelled.', { cancelled: true })
        }
        values.loopItems.set(node.id, item)
        values.loopIndexes.set(node.id, String(index))
        const bodyFailure = await runRegion(
          new Set(region.bodyNodeIds),
          new Set([region.eachTargetNodeId]),
          { loopNodeId: node.id, loopIteration: index }
        )
        if (bodyFailure) {
          return bodyFailure
        }
        const output = values.nodeOutputs.get(region.exitNodeId)
        if (output === undefined) {
          return failure('loop_output_missing', `Loop exit ${region.exitNodeId} has no output.`)
        }
        outputs.push(output)
      }
      values.loopItems.delete(node.id)
      values.loopIndexes.delete(node.id)
      const aggregate = JSON.stringify(outputs)
      values.loopOutputs.set(node.id, aggregate)
      const saved = await saveAgentsWorkflowNodeAnswer(input.executionContext, node.id, aggregate)
      if (saved !== null) {
        return failure(saved.code, saved.message)
      }
      return null
    }

    while (settledNodes.size < allowedNodeIds.size) {
      if (input.signal?.aborted) {
        return failure('cancelled', 'Workflow run was cancelled.', { cancelled: true })
      }
      const runnable = [...allowedNodeIds]
        .filter((nodeId) => {
          if (settledNodes.has(nodeId)) {
            return false
          }
          if (rootNodeIds.has(nodeId)) {
            return true
          }
          const states = incoming(nodeId).map((edge) => edgeStates.get(edge.id) ?? 'pending')
          return states.length > 0 && states.every((state) => state !== 'pending')
        })
        .sort()

      if (runnable.length === 0) {
        return failure('scheduler_deadlock', 'No workflow node can make progress.')
      }

      const node = nodesById.get(runnable[0])
      if (!node) {
        return failure('node_missing', `Workflow node ${runnable[0]} is unavailable.`)
      }
      const hasActiveInput =
        rootNodeIds.has(node.id) ||
        incoming(node.id).some((edge) => edgeStates.get(edge.id) === 'active')
      if (!hasActiveInput) {
        skipNode(node)
        continue
      }

      if (node.kind === 'start') {
        executionTrace.push(node.id)
      } else if (node.kind === 'agent') {
        const agentFailure = await runAgent(node)
        if (agentFailure) {
          return agentFailure
        }
      } else if (node.kind === 'condition') {
        const value = resolveAgentsWorkflowVariable(node.input, values)
        const branch = value === null ? null : evaluateAgentsWorkflowCondition(node, value)
        if (!branch) {
          return failure(
            'condition_evaluation_failed',
            `Condition ${node.id} could not be evaluated.`
          )
        }
        const attempt = {
          ...createAttempt(
            node.id,
            'completed',
            loopContext?.loopNodeId,
            loopContext?.loopIteration
          ),
          selectedBranch: branch
        }
        attempts.push(attempt)
        executionTrace.push(node.id)
        await checkpoint()
        settleEdges(node.id, (edge) => edge.fromPort === branch)
        settledNodes.add(node.id)
        continue
      } else {
        executionTrace.push(node.id)
        const loopFailure = await runLoop(node)
        if (loopFailure) {
          return loopFailure
        }
        attempts.push(
          createAttempt(node.id, 'completed', loopContext?.loopNodeId, loopContext?.loopIteration)
        )
        await checkpoint()
        settleEdges(node.id, (edge) => edge.fromPort === 'done')
        settledNodes.add(node.id)
        continue
      }
      settledNodes.add(node.id)
      settleEdges(node.id, () => true)
    }
    return null
  }

  const mainNodeIds = new Set(
    input.definition.nodes.map((node) => node.id).filter((nodeId) => !bodyNodeIds.has(nodeId))
  )
  const scheduleFailure = await runRegion(mainNodeIds, new Set([compiled.graph.startNodeId]))
  if (scheduleFailure) {
    for (const nodeId of mainNodeIds) {
      if (
        !attempts.some((attempt) => attempt.nodeId === nodeId) &&
        nodeId !== compiled.graph.startNodeId
      ) {
        attempts.push({
          ...createAttempt(nodeId, 'skipped'),
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
