import type { Edge, Node } from '@xyflow/react'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../../../shared/agents-workflow-types'
import type { AgentsWorkflowValidationIssue } from '../../../../shared/agents-workflow-graph'

export type AgentsWorkflowCanvasNodeData = {
  workflowNode: AgentsWorkflowNode
  issues: AgentsWorkflowValidationIssue[]
}

export type AgentsWorkflowCanvasNode = Node<AgentsWorkflowCanvasNodeData, 'workflow'>
export type AgentsWorkflowCanvasEdge = Edge<{ workflowEdge: AgentsWorkflowEdge }, 'workflow'>

export function toAgentsWorkflowCanvasNodes(
  definition: AgentsWorkflowDefinition,
  issues: readonly AgentsWorkflowValidationIssue[]
): AgentsWorkflowCanvasNode[] {
  return definition.nodes.map((workflowNode) => ({
    id: workflowNode.id,
    type: 'workflow',
    position: workflowNode.position,
    data: {
      workflowNode,
      issues: issues.filter((entry) => entry.nodeId === workflowNode.id)
    }
  }))
}

export function toAgentsWorkflowCanvasEdges(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowCanvasEdge[] {
  return definition.edges.map((workflowEdge) => ({
    id: workflowEdge.id,
    type: 'workflow',
    source: workflowEdge.fromNodeId,
    target: workflowEdge.toNodeId,
    sourceHandle: workflowEdge.fromPort,
    targetHandle: workflowEdge.toPort,
    data: { workflowEdge },
    animated: workflowEdge.toPort === 'aggregate'
  }))
}
