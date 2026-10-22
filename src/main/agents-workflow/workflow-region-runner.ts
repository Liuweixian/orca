// Executing one region of the graph: pick the next node, run it, settle its outgoing edges.

import type { AgentsWorkflowEdge, AgentsWorkflowNode } from '../../shared/agents-workflow-types'
import { agentsWorkflowLoopCount } from './workflow-runtime-values'
import { saveAgentsWorkflowNodeAnswer } from './workflow-node-answer'
import { runWorkflowAgentNode } from './workflow-agent-node-runner'
import { runWorkflowConditionNode } from './workflow-condition-node-runner'
import { writeAgentsWorkflowLoopIteration } from './workflow-upstream-files'
import {
  createWorkflowAttempt,
  workflowRegionFailure,
  type WorkflowLoopContext,
  type WorkflowRegionContext,
  type WorkflowRegionFailure
} from './workflow-region-types'

type EdgeState = 'pending' | 'active' | 'inactive'

export async function runWorkflowRegion(
  context: WorkflowRegionContext,
  allowedNodeIds: ReadonlySet<string>,
  rootNodeIds: ReadonlySet<string>,
  loopContext?: WorkflowLoopContext
): Promise<WorkflowRegionFailure | null> {
  const relevantEdges = context.definition.edges.filter(
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
    context.attempts.push({
      ...createWorkflowAttempt(context, node.id, 'skipped', loopContext),
      errorCode: 'condition_not_selected'
    })
  }

  while (settledNodes.size < allowedNodeIds.size) {
    if (context.signal?.aborted) {
      return workflowRegionFailure(context, 'cancelled', 'Workflow run was cancelled.', {
        cancelled: true
      })
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
      return workflowRegionFailure(
        context,
        'scheduler_deadlock',
        'No workflow node can make progress.'
      )
    }

    const node = context.nodesById.get(runnable[0])
    if (!node) {
      return workflowRegionFailure(
        context,
        'node_missing',
        `Workflow node ${runnable[0]} is unavailable.`
      )
    }
    const hasActiveInput =
      rootNodeIds.has(node.id) ||
      incoming(node.id).some((edge) => edgeStates.get(edge.id) === 'active')
    if (!hasActiveInput) {
      skipNode(node)
      continue
    }

    if (node.kind === 'start') {
      context.executionTrace.push(node.id)
    } else if (node.kind === 'agent') {
      const agentFailure = await runWorkflowAgentNode(context, node, loopContext)
      if (agentFailure) {
        return agentFailure
      }
    } else if (node.kind === 'condition') {
      const judged = await runWorkflowConditionNode(context, node, loopContext)
      if (!judged.ok) {
        return judged.failure
      }
      settleEdges(node.id, (edge) => edge.fromPort === judged.decision)
      settledNodes.add(node.id)
      continue
    } else {
      context.executionTrace.push(node.id)
      const loopFailure = await runWorkflowLoopNode(context, node)
      if (loopFailure) {
        return loopFailure
      }
      context.attempts.push(createWorkflowAttempt(context, node.id, 'completed', loopContext))
      await context.checkpoint()
      settleEdges(node.id, (edge) => edge.fromPort === 'done')
      settledNodes.add(node.id)
      continue
    }
    settledNodes.add(node.id)
    settleEdges(node.id, () => true)
  }
  return null
}

async function runWorkflowLoopNode(
  context: WorkflowRegionContext,
  node: Extract<AgentsWorkflowNode, { kind: 'loop' }>
): Promise<WorkflowRegionFailure | null> {
  const region = context.loopRegions.find((entry) => entry.loopNodeId === node.id)
  if (!region) {
    return workflowRegionFailure(
      context,
      'loop_region_missing',
      `Loop region ${node.id} is unavailable.`
    )
  }
  const count = agentsWorkflowLoopCount(node)
  const outputs: string[] = []
  for (let index = 0; index < count; index += 1) {
    if (context.signal?.aborted) {
      return workflowRegionFailure(context, 'cancelled', 'Workflow run was cancelled.', {
        cancelled: true
      })
    }
    const noted = await writeAgentsWorkflowLoopIteration(
      context.executionContext,
      node.id,
      index,
      count
    )
    if (noted !== null) {
      return workflowRegionFailure(context, noted.code, noted.message)
    }
    // Why clear: a node skipped this turn must not keep last turn's value, or the aggregate would
    // record an answer that belongs to an earlier iteration.
    for (const bodyNodeId of region.bodyNodeIds) {
      context.values.nodeOutputs.delete(bodyNodeId)
      context.values.loopOutputs.delete(bodyNodeId)
    }
    const bodyFailure = await runWorkflowRegion(
      context,
      new Set(region.bodyNodeIds),
      new Set([region.eachTargetNodeId]),
      { loopNodeId: node.id, loopIteration: index }
    )
    if (bodyFailure) {
      return bodyFailure
    }
    const output = context.values.nodeOutputs.get(region.exitNodeId)
    if (output === undefined) {
      return workflowRegionFailure(
        context,
        'loop_output_missing',
        `Loop exit ${region.exitNodeId} has no output.`
      )
    }
    outputs.push(output)
  }
  const aggregate = JSON.stringify(outputs)
  context.values.loopOutputs.set(node.id, aggregate)
  const saved = await saveAgentsWorkflowNodeAnswer(context.executionContext, node.id, aggregate)
  if (saved !== null) {
    return workflowRegionFailure(context, saved.code, saved.message)
  }
  return null
}
