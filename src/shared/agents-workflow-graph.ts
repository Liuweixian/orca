import {
  agentsWorkflowAvailableVariableRefs,
  analyzeAgentsWorkflowGraph,
  type AgentsWorkflowGraphAnalysis,
  type AgentsWorkflowLoopRegion
} from './agents-workflow-graph-analysis'
import { validateParsedAgentsWorkflowDefinition } from './agents-workflow-graph-validation'
import {
  AGENTS_WORKFLOW_BINDING_TOKEN,
  agentsWorkflowPromptBindingKeys,
  hasInvalidAgentsWorkflowPromptToken
} from './agents-workflow-prompt-tokens'
import {
  AgentsWorkflowDefinitionSchema,
  type AgentsWorkflowDefinition,
  type AgentsWorkflowEdge,
  type AgentsWorkflowPrompt,
  type AgentsWorkflowVariableRef
} from './agents-workflow-types'

export type AgentsWorkflowValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  nodeId?: string
  edgeId?: string
}

export type AgentsWorkflowCompiledNode = {
  nodeId: string
  incomingEdgeIds: string[]
  outgoingEdgeIds: string[]
}

export type AgentsWorkflowCompiledGraph = {
  schemaVersion: 1
  startNodeId: string
  topologicalNodeIds: string[]
  nodes: AgentsWorkflowCompiledNode[]
  loopRegions: AgentsWorkflowLoopRegion[]
}

export type AgentsWorkflowCompileResult =
  | { ok: true; graph: AgentsWorkflowCompiledGraph }
  | { ok: false; issues: AgentsWorkflowValidationIssue[] }

export type AgentsWorkflowPromptValues = {
  runInput: string
  nodeOutputs: Readonly<Record<string, string>>
  loopItems: Readonly<Record<string, string>>
  loopIndexes: Readonly<Record<string, string>>
  loopOutputs: Readonly<Record<string, string>>
}

export type AgentsWorkflowRenderPromptResult =
  | { ok: true; value: string }
  | {
      ok: false
      code: 'invalid_token' | 'missing_binding' | 'missing_value'
      bindingKey?: string
      ref?: AgentsWorkflowVariableRef
    }

export function agentsWorkflowVariableRefKey(ref: AgentsWorkflowVariableRef): string {
  switch (ref.kind) {
    case 'run_input':
      return ref.kind
    case 'node_output':
      return `${ref.kind}:${ref.nodeId}`
    case 'loop_item':
    case 'loop_index':
    case 'loop_output':
      return `${ref.kind}:${ref.loopNodeId}`
  }
}

export function availableVariableRefs(
  definition: AgentsWorkflowDefinition,
  targetNodeId: string
): AgentsWorkflowVariableRef[] {
  return agentsWorkflowAvailableVariableRefs(definition, targetNodeId)
}

export function validateWorkflowDefinition(input: unknown): AgentsWorkflowValidationIssue[] {
  const parsed = AgentsWorkflowDefinitionSchema.safeParse(input)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      severity: 'error',
      code: 'schema_invalid',
      message: `${issue.path.join('.') || 'definition'}: ${issue.message}`
    }))
  }
  return validateParsedAgentsWorkflowDefinition(parsed.data)
}

function topologicalNodeIds(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): string[] {
  const indegree = new Map(definition.nodes.map((node) => [node.id, 0]))
  for (const edge of analysis.controlEdges) {
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1)
  }
  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId)
    .sort()
  const ordered: string[] = []
  while (ready.length > 0) {
    const nodeId = ready.shift()
    if (!nodeId) {
      continue
    }
    ordered.push(nodeId)
    for (const edge of analysis.outgoing.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(edge.toNodeId) ?? 0) - 1
      indegree.set(edge.toNodeId, nextDegree)
      if (nextDegree === 0) {
        ready.push(edge.toNodeId)
        ready.sort()
      }
    }
  }
  return ordered
}

function compiledNode(
  nodeId: string,
  definition: AgentsWorkflowDefinition
): AgentsWorkflowCompiledNode {
  const byId = (left: AgentsWorkflowEdge, right: AgentsWorkflowEdge): number =>
    left.id.localeCompare(right.id)
  return {
    nodeId,
    incomingEdgeIds: definition.edges
      .filter((edge) => edge.toNodeId === nodeId)
      .sort(byId)
      .map((edge) => edge.id),
    outgoingEdgeIds: definition.edges
      .filter((edge) => edge.fromNodeId === nodeId)
      .sort(byId)
      .map((edge) => edge.id)
  }
}

export function compileWorkflowGraph(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowCompileResult {
  const issues = validateParsedAgentsWorkflowDefinition(definition)
  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, issues }
  }
  const analysis = analyzeAgentsWorkflowGraph(definition)
  const startNodeId = definition.nodes.find((node) => node.kind === 'start')?.id
  if (!startNodeId) {
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'start_count',
          message: 'A workflow must contain exactly one start node.'
        }
      ]
    }
  }
  const topological = topologicalNodeIds(definition, analysis)
  return {
    ok: true,
    graph: {
      schemaVersion: 1,
      startNodeId,
      topologicalNodeIds: topological,
      nodes: topological.map((nodeId) => compiledNode(nodeId, definition)),
      loopRegions: analysis.loopRegions
    }
  }
}

function valueForRef(
  ref: AgentsWorkflowVariableRef,
  values: AgentsWorkflowPromptValues
): string | undefined {
  switch (ref.kind) {
    case 'run_input':
      return values.runInput
    case 'node_output':
      return values.nodeOutputs[ref.nodeId]
    case 'loop_item':
      return values.loopItems[ref.loopNodeId]
    case 'loop_index':
      return values.loopIndexes[ref.loopNodeId]
    case 'loop_output':
      return values.loopOutputs[ref.loopNodeId]
  }
}

export function renderPrompt(
  prompt: AgentsWorkflowPrompt,
  values: AgentsWorkflowPromptValues
): AgentsWorkflowRenderPromptResult {
  if (hasInvalidAgentsWorkflowPromptToken(prompt.source)) {
    return { ok: false, code: 'invalid_token' }
  }
  let failure: Exclude<AgentsWorkflowRenderPromptResult, { ok: true }> | null = null
  const value = prompt.source.replace(
    AGENTS_WORKFLOW_BINDING_TOKEN,
    (_token, bindingKey: string) => {
      const ref = prompt.bindings[bindingKey]
      if (!ref) {
        failure ??= { ok: false, code: 'missing_binding', bindingKey }
        return ''
      }
      const resolved = valueForRef(ref, values)
      if (resolved === undefined) {
        failure ??= { ok: false, code: 'missing_value', bindingKey, ref }
        return ''
      }
      return resolved
    }
  )
  return failure ?? { ok: true, value }
}

export { agentsWorkflowPromptBindingKeys, hasInvalidAgentsWorkflowPromptToken }
