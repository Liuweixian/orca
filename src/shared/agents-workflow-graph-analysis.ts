import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from './agents-workflow-types'

export type AgentsWorkflowLoopRegion = {
  loopNodeId: string
  eachTargetNodeId: string
  doneTargetNodeId: string
  exitNodeId: string
  bodyNodeIds: string[]
}

export type AgentsWorkflowGraphAnalysis = {
  nodesById: Map<string, AgentsWorkflowNode>
  controlEdges: AgentsWorkflowEdge[]
  incoming: Map<string, AgentsWorkflowEdge[]>
  outgoing: Map<string, AgentsWorkflowEdge[]>
  reachableNodeIds: Set<string>
  dominators: Map<string, Set<string>>
  loopRegions: AgentsWorkflowLoopRegion[]
  cyclicNodeIds: Set<string>
}

function edgeMap(
  nodeIds: Iterable<string>,
  edges: readonly AgentsWorkflowEdge[],
  endpoint: 'fromNodeId' | 'toNodeId'
): Map<string, AgentsWorkflowEdge[]> {
  const result = new Map<string, AgentsWorkflowEdge[]>()
  for (const nodeId of nodeIds) {
    result.set(nodeId, [])
  }
  for (const edge of edges) {
    result.get(edge[endpoint])?.push(edge)
  }
  return result
}

function reachableFrom(
  startNodeId: string | undefined,
  outgoing: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>
): Set<string> {
  const reached = new Set<string>()
  const pending = startNodeId ? [startNodeId] : []
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || reached.has(nodeId)) {
      continue
    }
    reached.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) {
      pending.push(edge.toNodeId)
    }
  }
  return reached
}

function nodesReaching(
  targetNodeId: string,
  incoming: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>
): Set<string> {
  const reached = new Set<string>()
  const pending = [targetNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || reached.has(nodeId)) {
      continue
    }
    reached.add(nodeId)
    for (const edge of incoming.get(nodeId) ?? []) {
      pending.push(edge.fromNodeId)
    }
  }
  return reached
}

function intersectSets(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const result = new Set<string>()
  for (const value of left) {
    if (right.has(value)) {
      result.add(value)
    }
  }
  return result
}

function computeDominators(
  startNodeId: string | undefined,
  reachableNodeIds: ReadonlySet<string>,
  incoming: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  if (!startNodeId || !reachableNodeIds.has(startNodeId)) {
    return result
  }
  for (const nodeId of reachableNodeIds) {
    result.set(nodeId, nodeId === startNodeId ? new Set([nodeId]) : new Set(reachableNodeIds))
  }
  let changed = true
  while (changed) {
    changed = false
    for (const nodeId of reachableNodeIds) {
      if (nodeId === startNodeId) {
        continue
      }
      const predecessors = (incoming.get(nodeId) ?? [])
        .map((edge) => edge.fromNodeId)
        .filter((candidate) => reachableNodeIds.has(candidate))
      let next = new Set<string>()
      if (predecessors.length > 0) {
        next = new Set(result.get(predecessors[0]) ?? [])
        for (const predecessor of predecessors.slice(1)) {
          next = intersectSets(next, result.get(predecessor) ?? new Set())
        }
      }
      next.add(nodeId)
      const current = result.get(nodeId)
      if (
        !current ||
        current.size !== next.size ||
        [...current].some((value) => !next.has(value))
      ) {
        result.set(nodeId, next)
        changed = true
      }
    }
  }
  return result
}

function cyclicNodes(
  nodeIds: Iterable<string>,
  outgoing: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>
): Set<string> {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cyclic = new Set<string>()
  const path: string[] = []

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) {
      return
    }
    if (visiting.has(nodeId)) {
      const cycleStart = path.lastIndexOf(nodeId)
      for (const member of path.slice(cycleStart)) {
        cyclic.add(member)
      }
      return
    }
    visiting.add(nodeId)
    path.push(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) {
      visit(edge.toNodeId)
    }
    path.pop()
    visiting.delete(nodeId)
    visited.add(nodeId)
  }

  for (const nodeId of nodeIds) {
    visit(nodeId)
  }
  return cyclic
}

function loopRegions(
  nodes: readonly AgentsWorkflowNode[],
  edges: readonly AgentsWorkflowEdge[],
  incoming: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>,
  outgoing: ReadonlyMap<string, readonly AgentsWorkflowEdge[]>
): AgentsWorkflowLoopRegion[] {
  const regions: AgentsWorkflowLoopRegion[] = []
  for (const node of nodes) {
    if (node.kind !== 'loop') {
      continue
    }
    const eachEdges = (outgoing.get(node.id) ?? []).filter((edge) => edge.fromPort === 'each')
    const doneEdges = (outgoing.get(node.id) ?? []).filter((edge) => edge.fromPort === 'done')
    const aggregateEdges = edges.filter(
      (edge) => edge.toNodeId === node.id && edge.toPort === 'aggregate'
    )
    const each = eachEdges.length === 1 ? eachEdges[0] : undefined
    const done = doneEdges.length === 1 ? doneEdges[0] : undefined
    const aggregate = aggregateEdges.length === 1 ? aggregateEdges[0] : undefined
    if (!each || !done || !aggregate) {
      continue
    }
    const fromEntry = reachableFrom(each.toNodeId, outgoing)
    const toExit = nodesReaching(aggregate.fromNodeId, incoming)
    const bodyNodeIds = [...intersectSets(fromEntry, toExit)].sort()
    regions.push({
      loopNodeId: node.id,
      eachTargetNodeId: each.toNodeId,
      doneTargetNodeId: done.toNodeId,
      exitNodeId: aggregate.fromNodeId,
      bodyNodeIds
    })
  }
  return regions
}

export function analyzeAgentsWorkflowGraph(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowGraphAnalysis {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]))
  const controlEdges = definition.edges.filter(
    (edge) =>
      edge.toPort !== 'aggregate' && nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId)
  )
  const incoming = edgeMap(nodesById.keys(), controlEdges, 'toNodeId')
  const outgoing = edgeMap(nodesById.keys(), controlEdges, 'fromNodeId')
  const startNodeId = definition.nodes.find((node) => node.kind === 'start')?.id
  const reachableNodeIds = reachableFrom(startNodeId, outgoing)
  return {
    nodesById,
    controlEdges,
    incoming,
    outgoing,
    reachableNodeIds,
    dominators: computeDominators(startNodeId, reachableNodeIds, incoming),
    loopRegions: loopRegions(definition.nodes, definition.edges, incoming, outgoing),
    cyclicNodeIds: cyclicNodes(nodesById.keys(), outgoing)
  }
}

export function agentsWorkflowNodesReachableFrom(
  nodeId: string,
  analysis: AgentsWorkflowGraphAnalysis
): Set<string> {
  return reachableFrom(nodeId, analysis.outgoing)
}

/**
 * A node feeds the end node when every edge leaving it lands on an end node: its answer is the
 * workflow's final record, because nothing downstream binds it. Such a node may settle from a pane
 * snapshot; any other node must deliver a value, since a later node would bind text off screen.
 */
export function agentsWorkflowNodeFeedsEnd(
  definition: Pick<AgentsWorkflowDefinition, 'nodes' | 'edges'>,
  nodeId: string
): boolean {
  const endIds = new Set(
    definition.nodes.filter((node) => node.kind === 'end').map((node) => node.id)
  )
  const outgoing = definition.edges.filter((edge) => edge.fromNodeId === nodeId)
  return outgoing.length > 0 && outgoing.every((edge) => endIds.has(edge.toNodeId))
}
