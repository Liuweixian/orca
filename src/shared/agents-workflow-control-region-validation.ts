import {
  agentsWorkflowNodesReachableFrom,
  type AgentsWorkflowGraphAnalysis
} from './agents-workflow-graph-analysis'
import type { AgentsWorkflowDefinition } from './agents-workflow-types'
import type { AgentsWorkflowValidationIssue } from './agents-workflow-graph'

function issue(
  input: Omit<AgentsWorkflowValidationIssue, 'severity'>
): AgentsWorkflowValidationIssue {
  return { severity: 'error', ...input }
}

function loopRegionIssues(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  for (const region of analysis.loopRegions) {
    const body = new Set(region.bodyNodeIds)
    const reachedFromEntry = agentsWorkflowNodesReachableFrom(region.eachTargetNodeId, analysis)
    if ([...reachedFromEntry].some((nodeId) => !body.has(nodeId))) {
      issues.push(
        issue({
          code: 'loop_body_escape',
          message: 'Every loop body path must reach the aggregate exit.',
          nodeId: region.loopNodeId
        })
      )
    }
    if (body.has(region.loopNodeId)) {
      issues.push(
        issue({
          code: 'loop_contains_itself',
          message: 'Loop body cannot contain its controller.',
          nodeId: region.loopNodeId
        })
      )
    }
    for (const nodeId of body) {
      const node = analysis.nodesById.get(nodeId)
      if (node?.kind === 'loop') {
        issues.push(
          issue({
            code: 'nested_loop',
            message: 'Nested loops are not supported.',
            nodeId
          })
        )
      }
      for (const edge of definition.edges.filter((candidate) => candidate.toNodeId === nodeId)) {
        const validEntry =
          edge.fromNodeId === region.loopNodeId &&
          edge.fromPort === 'each' &&
          nodeId === region.eachTargetNodeId
        if (!body.has(edge.fromNodeId) && !validEntry) {
          issues.push(
            issue({
              code: 'loop_body_external_entry',
              message: 'Only the loop each edge may enter its body.',
              nodeId,
              edgeId: edge.id
            })
          )
        }
      }
      for (const edge of definition.edges.filter((candidate) => candidate.fromNodeId === nodeId)) {
        const validAggregate =
          nodeId === region.exitNodeId &&
          edge.toNodeId === region.loopNodeId &&
          edge.toPort === 'aggregate'
        if (!body.has(edge.toNodeId) && !validAggregate) {
          issues.push(
            issue({
              code: 'loop_body_external_exit',
              message: 'Only the aggregate edge may leave a loop body.',
              nodeId,
              edgeId: edge.id
            })
          )
        }
      }
    }
    if ((analysis.outgoing.get(region.exitNodeId) ?? []).length > 0) {
      issues.push(
        issue({
          code: 'loop_exit_has_control_edge',
          message: 'The loop exit may only connect to the aggregate port.',
          nodeId: region.exitNodeId
        })
      )
    }
  }
  return issues
}

function terminalPathIssues(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): AgentsWorkflowValidationIssue[] {
  const targets = new Map<string, string[]>()
  for (const node of definition.nodes) {
    targets.set(
      node.id,
      (analysis.outgoing.get(node.id) ?? []).map((edge) => edge.toNodeId)
    )
  }
  for (const region of analysis.loopRegions) {
    targets.get(region.exitNodeId)?.push(region.doneTargetNodeId)
  }
  const memo = new Map<string, boolean>()
  const visiting = new Set<string>()
  const reachesTerminal = (nodeId: string): boolean => {
    const known = memo.get(nodeId)
    if (known !== undefined) {
      return known
    }
    if (visiting.has(nodeId)) {
      return false
    }
    const node = analysis.nodesById.get(nodeId)
    if (node?.kind === 'agent' && node.terminal) {
      memo.set(nodeId, true)
      return true
    }
    visiting.add(nodeId)
    const next = targets.get(nodeId) ?? []
    const result = next.length > 0 && next.every(reachesTerminal)
    visiting.delete(nodeId)
    memo.set(nodeId, result)
    return result
  }
  return definition.nodes.flatMap((node) =>
    analysis.reachableNodeIds.has(node.id) && !reachesTerminal(node.id)
      ? [
          issue({
            code: 'path_without_terminal',
            message: 'Every control-flow path must end at a terminal agent.',
            nodeId: node.id
          })
        ]
      : []
  )
}

export function validateAgentsWorkflowControlRegions(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): AgentsWorkflowValidationIssue[] {
  return [...loopRegionIssues(definition, analysis), ...terminalPathIssues(definition, analysis)]
}
