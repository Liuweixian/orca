import { compileWorkflowGraph, renderPrompt } from '../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowNodeOutput
} from '../../shared/agents-workflow-run-types'
import {
  evaluateAgentsWorkflowCondition,
  resolveAgentsWorkflowLoopItems,
  resolveAgentsWorkflowVariable,
  type AgentsWorkflowRuntimeValues
} from './workflow-runtime-values'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from './structured-agent-output-capture'

const AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES = 20 * 1024 * 1024

export type AgentsWorkflowStepExecutor = (input: {
  runId?: string
  workspaceId?: string
  node: Extract<AgentsWorkflowNode, { kind: 'agent' }>
  prompt: string
  loopNodeId?: string
  loopIteration?: number
  signal?: AbortSignal
}) => Promise<
  | { ok: true; output: AgentsWorkflowNodeOutput }
  | { ok: false; code: string; message: string; unverifiable?: boolean }
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

type ExecutionFailure = Extract<AgentsWorkflowScheduleResult, { ok: false }>
type EdgeState = 'pending' | 'active' | 'inactive'

function promptValues(values: AgentsWorkflowRuntimeValues) {
  return {
    runInput: values.runInput,
    nodeOutputs: Object.fromEntries(values.nodeOutputs),
    loopItems: Object.fromEntries(values.loopItems),
    loopIndexes: Object.fromEntries(values.loopIndexes),
    loopOutputs: Object.fromEntries(values.loopOutputs)
  }
}

export async function executeAgentsWorkflowSchedule(input: {
  definition: AgentsWorkflowDefinition
  runInput: string
  executeAgent: AgentsWorkflowStepExecutor
  now?: () => number
  signal?: AbortSignal
  executionContext?: { runId: string; workspaceId: string }
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
  ): AgentsWorkflowNodeAttempt => ({
    id: `${nodeId}:${attempts.length + 1}`,
    nodeId,
    status,
    ...(loopNodeId === undefined ? {} : { loopNodeId }),
    ...(loopIteration === undefined ? {} : { loopIteration }),
    startedAt: status === 'skipped' ? null : now(),
    finishedAt: status === 'running' || status === 'pending' ? null : now(),
    output: null
  })

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
      const rendered = renderPrompt(node.prompt, promptValues(values))
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
      const result = await input.executeAgent({
        ...input.executionContext,
        node,
        prompt: rendered.value,
        loopNodeId: loopContext?.loopNodeId,
        loopIteration: loopContext?.loopIteration,
        signal: input.signal
      })
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
      if (result.output.truncated || result.output.source !== 'structured_assistant_message') {
        attempt.status = 'failed'
        attempt.errorCode = 'output_untrusted'
        attempt.errorMessage = 'The agent did not produce a complete structured output.'
        await checkpoint()
        return failure(attempt.errorCode, attempt.errorMessage)
      }
      attempt.status = 'completed'
      values.nodeOutputs.set(node.id, result.output.content)
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
      values.loopOutputs.set(node.id, JSON.stringify(outputs))
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
