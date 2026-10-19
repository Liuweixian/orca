import {
  agentsWorkflowAvailableVariableRefs,
  type AgentsWorkflowGraphAnalysis
} from './agents-workflow-graph-analysis'
import {
  agentsWorkflowPromptBindingKeys,
  hasInvalidAgentsWorkflowPromptToken
} from './agents-workflow-prompt-tokens'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowPrompt,
  AgentsWorkflowVariableRef
} from './agents-workflow-types'
import type { AgentsWorkflowValidationIssue } from './agents-workflow-graph'

function issue(
  input: Omit<AgentsWorkflowValidationIssue, 'severity'> & {
    severity?: AgentsWorkflowValidationIssue['severity']
  }
): AgentsWorkflowValidationIssue {
  return { severity: input.severity ?? 'error', ...input }
}

function refKey(ref: AgentsWorkflowVariableRef): string {
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

function refIssues(
  ref: AgentsWorkflowVariableRef,
  available: ReadonlySet<string>,
  nodeId: string
): AgentsWorkflowValidationIssue[] {
  return available.has(refKey(ref))
    ? []
    : [
        issue({
          code: 'variable_out_of_scope',
          message: `Variable ${refKey(ref)} is not available at this node.`,
          nodeId
        })
      ]
}

function promptIssues(
  prompt: AgentsWorkflowPrompt,
  available: ReadonlySet<string>,
  nodeId: string
): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  if (hasInvalidAgentsWorkflowPromptToken(prompt.source)) {
    issues.push(
      issue({
        code: 'prompt_token_invalid',
        message: 'Prompt contains an invalid variable token.',
        nodeId
      })
    )
  }
  const used = new Set(agentsWorkflowPromptBindingKeys(prompt.source))
  for (const bindingKey of used) {
    const ref = prompt.bindings[bindingKey]
    if (!ref) {
      issues.push(
        issue({
          code: 'prompt_binding_missing',
          message: `Prompt binding ${bindingKey} is missing.`,
          nodeId
        })
      )
    } else {
      issues.push(...refIssues(ref, available, nodeId))
    }
  }
  for (const [bindingKey, ref] of Object.entries(prompt.bindings)) {
    if (!used.has(bindingKey)) {
      issues.push(
        issue({
          severity: 'warning',
          code: 'prompt_binding_unused',
          message: `Prompt binding ${bindingKey} is unused.`,
          nodeId
        }),
        ...refIssues(ref, available, nodeId)
      )
    }
  }
  return issues
}

export function validateAgentsWorkflowVariables(
  definition: AgentsWorkflowDefinition,
  analysis: AgentsWorkflowGraphAnalysis
): AgentsWorkflowValidationIssue[] {
  const issues: AgentsWorkflowValidationIssue[] = []
  for (const node of definition.nodes) {
    const available = new Set(
      agentsWorkflowAvailableVariableRefs(definition, node.id, analysis).map(refKey)
    )
    if (node.kind === 'agent') {
      issues.push(...promptIssues(node.prompt, available, node.id))
    } else if (node.kind === 'condition') {
      issues.push(...refIssues(node.input, available, node.id))
    } else if (node.kind === 'loop' && node.iteration.mode === 'list') {
      issues.push(...refIssues(node.iteration.items, available, node.id))
    }
  }
  return issues
}
