import { parseExecutionHostId } from './execution-host'
import {
  agentsWorkflowNodeIsTerminal,
  analyzeAgentsWorkflowGraph,
  type AgentsWorkflowGraphAnalysis
} from './agents-workflow-graph-analysis'
import { validateAgentsWorkflowControlRegions } from './agents-workflow-control-region-validation'
import { agentsWorkflowPromptDeclaresDecision } from './agents-workflow-decision'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from './agents-workflow-types'
import type { AgentsWorkflowValidationIssue } from './agents-workflow-graph'

type IssueInput = Omit<AgentsWorkflowValidationIssue, 'severity' | 'message'> & {
  message: string
  severity?: AgentsWorkflowValidationIssue['severity']
}

function issue(input: IssueInput): AgentsWorkflowValidationIssue {
  return { severity: input.severity ?? 'error', ...input }
}

function duplicateValues(values: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }
  return duplicates
}

function validSourcePort(node: AgentsWorkflowNode, edge: AgentsWorkflowEdge): boolean {
  switch (node.kind) {
    case 'start':
    case 'agent':
      return edge.fromPort === 'default'
    case 'condition':
      return edge.fromPort === 'yes' || edge.fromPort === 'no'
    case 'loop':
      return edge.fromPort === 'each' || edge.fromPort === 'done'
  }
}

function edgeIssues(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  for (const nodeId of duplicateValues(definition.nodes.map((node) => node.id))) {
    issues.push(
      issue({ code: 'duplicate_node_id', message: `Duplicate node id: ${nodeId}`, nodeId })
    )
  }
  for (const edgeId of duplicateValues(definition.edges.map((edge) => edge.id))) {
    issues.push(
      issue({ code: 'duplicate_edge_id', message: `Duplicate edge id: ${edgeId}`, edgeId })
    )
  }
  const signatures = new Set<string>()
  for (const edge of definition.edges) {
    const from = analysis.nodesById.get(edge.fromNodeId)
    const to = analysis.nodesById.get(edge.toNodeId)
    if (!from || !to) {
      issues.push(
        issue({
          code: 'edge_endpoint_missing',
          message: `Edge ${edge.id} refers to a missing node.`,
          edgeId: edge.id
        })
      )
      continue
    }
    if (edge.fromNodeId === edge.toNodeId) {
      issues.push(
        issue({ code: 'self_edge', message: 'Self edges are not allowed.', edgeId: edge.id })
      )
    }
    const signature = [edge.fromNodeId, edge.fromPort, edge.toNodeId, edge.toPort].join('\u0000')
    if (signatures.has(signature)) {
      issues.push(
        issue({ code: 'duplicate_edge', message: 'Duplicate edge connection.', edgeId: edge.id })
      )
    }
    signatures.add(signature)
    if (!validSourcePort(from, edge)) {
      issues.push(
        issue({
          code: 'invalid_source_port',
          message: `Port ${edge.fromPort} is not valid for ${from.kind}.`,
          edgeId: edge.id,
          nodeId: from.id
        })
      )
    }
    if (
      (edge.toPort === 'aggregate' && to.kind !== 'loop') ||
      (edge.toPort === 'default' && to.kind === 'start')
    ) {
      issues.push(
        issue({
          code: 'invalid_target_port',
          message: `Port ${edge.toPort} is not valid for ${to.kind}.`,
          edgeId: edge.id,
          nodeId: to.id
        })
      )
    }
  }
  return issues
}

function terminalNodeIssues(definition: AgentsWorkflowDefinition): AgentsWorkflowValidationIssue[] {
  const terminals = definition.nodes.filter((node) =>
    agentsWorkflowNodeIsTerminal(definition, node.id)
  )
  if (terminals.length !== 1) {
    return [
      issue({
        code: 'terminal_node_count',
        message: 'A workflow must end at exactly one node with no outgoing connection.'
      })
    ]
  }
  const terminal = terminals[0]
  if (terminal.kind !== 'agent') {
    return [
      issue({
        code: 'terminal_node_kind',
        message: 'The node that ends a workflow must be an agent.',
        nodeId: terminal.id
      })
    ]
  }
  return []
}

function nodePortIssues(definition: AgentsWorkflowDefinition): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  const starts = definition.nodes.filter((node) => node.kind === 'start')
  if (starts.length !== 1) {
    issues.push(
      issue({ code: 'start_count', message: 'A workflow must contain exactly one start node.' })
    )
  }
  for (const node of definition.nodes) {
    const incoming = definition.edges.filter((edge) => edge.toNodeId === node.id)
    const outgoing = definition.edges.filter((edge) => edge.fromNodeId === node.id)
    if (!node.title.trim()) {
      issues.push(
        issue({ code: 'node_title_required', message: 'Node title is required.', nodeId: node.id })
      )
    }
    if (node.kind === 'start') {
      if (incoming.length > 0) {
        issues.push(
          issue({
            code: 'start_has_incoming',
            message: 'Start cannot have incoming edges.',
            nodeId: node.id
          })
        )
      }
    }
    if (node.kind === 'condition') {
      // The agent's answer is parsed as JSON, so a prompt that never asks for it cannot succeed.
      if (!node.prompt.source.trim()) {
        issues.push(
          issue({
            code: 'condition_prompt_required',
            message: 'A condition needs a judging prompt.',
            nodeId: node.id
          })
        )
      } else if (!agentsWorkflowPromptDeclaresDecision(node.prompt.source)) {
        issues.push(
          issue({
            code: 'condition_decision_contract_missing',
            message:
              'The judging prompt must ask the agent for {"decision":"yes"} or {"decision":"no"}.',
            nodeId: node.id
          })
        )
      }
      for (const port of ['yes', 'no'] as const) {
        if (outgoing.filter((edge) => edge.fromPort === port).length !== 1) {
          issues.push(
            issue({
              code: 'condition_branch_count',
              message: `Condition must have exactly one ${port} edge.`,
              nodeId: node.id
            })
          )
        }
      }
    }
    if (node.kind === 'loop') {
      for (const port of ['each', 'done'] as const) {
        if (outgoing.filter((edge) => edge.fromPort === port).length !== 1) {
          issues.push(
            issue({
              code: 'loop_branch_count',
              message: `Loop must have exactly one ${port} edge.`,
              nodeId: node.id
            })
          )
        }
      }
      if (incoming.filter((edge) => edge.toPort === 'aggregate').length !== 1) {
        issues.push(
          issue({
            code: 'loop_aggregate_count',
            message: 'Loop must have exactly one aggregate edge.',
            nodeId: node.id
          })
        )
      }
    }
  }
  return issues
}

export function validateParsedAgentsWorkflowDefinition(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowValidationIssue[] {
  const analysis = analyzeAgentsWorkflowGraph(definition)
  const issues = [
    ...edgeIssues(definition, analysis),
    ...nodePortIssues(definition),
    ...terminalNodeIssues(definition)
  ]
  if (!definition.name.trim()) {
    issues.push(issue({ code: 'workflow_name_required', message: 'Workflow name is required.' }))
  }
  const host = parseExecutionHostId(definition.runContext.hostId)
  if (!host || host.kind !== 'local') {
    issues.push(
      issue({
        code: 'run_context_not_local',
        message: 'MVP workflows require a local desktop execution target.'
      })
    )
  }
  for (const node of definition.nodes) {
    if (!analysis.reachableNodeIds.has(node.id)) {
      issues.push(
        issue({
          code: 'node_unreachable',
          message: 'Every node must be reachable from start.',
          nodeId: node.id
        })
      )
    }
  }
  for (const nodeId of analysis.cyclicNodeIds) {
    issues.push(
      issue({ code: 'control_cycle', message: 'Control-flow cycles are not allowed.', nodeId })
    )
  }
  issues.push(...validateAgentsWorkflowControlRegions(definition, analysis))
  return issues
}
