// The boundary rules: a workflow has one end node, nothing leaves it, and every node can reach it.

import type { AgentsWorkflowValidationIssue } from './agents-workflow-graph'
import type { AgentsWorkflowDefinition, AgentsWorkflowEdge } from './agents-workflow-types'

function issue(
  input: Omit<AgentsWorkflowValidationIssue, 'severity'>
): AgentsWorkflowValidationIssue {
  return { severity: 'error', ...input }
}

/**
 * Every node whose edge path can eventually reach `targetNodeId`, `targetNodeId` included.
 *
 * Why not the analysis: `analysis.outgoing` drops aggregate edges, but a loop body reaches the
 * loop only through its aggregate edge, so the control-flow view would call the body stranded.
 */
function nodesReaching(targetNodeId: string, edges: readonly AgentsWorkflowEdge[]): Set<string> {
  const reached = new Set<string>()
  const pending = [targetNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || reached.has(nodeId)) {
      continue
    }
    reached.add(nodeId)
    for (const edge of edges) {
      if (edge.toNodeId === nodeId) {
        pending.push(edge.fromNodeId)
      }
    }
  }
  return reached
}

export function validateAgentsWorkflowEndNode(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  const ends = definition.nodes.filter((node) => node.kind === 'end')
  if (ends.length !== 1) {
    return [
      issue({
        code: 'end_count',
        message: 'A workflow must contain exactly one end node.'
      })
    ]
  }
  const end = ends[0]
  const reachingEnd = nodesReaching(end.id, definition.edges)
  for (const node of definition.nodes) {
    if (node.id !== end.id && !reachingEnd.has(node.id)) {
      issues.push(
        issue({
          code: 'node_not_reaching_end',
          message: 'Every node must reach the end node.',
          nodeId: node.id
        })
      )
    }
  }
  return issues
}
