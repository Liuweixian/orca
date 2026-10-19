import type {
  AgentsWorkflowNode,
  AgentsWorkflowVariableRef
} from '../../shared/agents-workflow-types'

export type AgentsWorkflowRuntimeValues = {
  runInput: string
  nodeOutputs: Map<string, string>
  loopItems: Map<string, string>
  loopIndexes: Map<string, string>
  loopOutputs: Map<string, string>
}

export function resolveAgentsWorkflowVariable(
  ref: AgentsWorkflowVariableRef,
  values: AgentsWorkflowRuntimeValues
): string | null {
  switch (ref.kind) {
    case 'run_input':
      return values.runInput
    case 'node_output':
      return values.nodeOutputs.get(ref.nodeId) ?? null
    case 'loop_item':
      return values.loopItems.get(ref.loopNodeId) ?? null
    case 'loop_index':
      return values.loopIndexes.get(ref.loopNodeId) ?? null
    case 'loop_output':
      return values.loopOutputs.get(ref.loopNodeId) ?? null
  }
}

export function evaluateAgentsWorkflowCondition(
  node: Extract<AgentsWorkflowNode, { kind: 'condition' }>,
  value: string
): 'yes' | 'no' | null {
  switch (node.operator) {
    case 'contains':
      return node.operand === undefined ? null : value.includes(node.operand) ? 'yes' : 'no'
    case 'not_contains':
      return node.operand === undefined ? null : value.includes(node.operand) ? 'no' : 'yes'
    case 'empty':
      return value.length === 0 ? 'yes' : 'no'
    case 'not_empty':
      return value.length > 0 ? 'yes' : 'no'
    case 'length_gte': {
      if (node.operand === undefined) {
        return null
      }
      const threshold = Number(node.operand)
      return Number.isInteger(threshold) && threshold >= 0
        ? value.length >= threshold
          ? 'yes'
          : 'no'
        : null
    }
  }
}

export function resolveAgentsWorkflowLoopItems(
  node: Extract<AgentsWorkflowNode, { kind: 'loop' }>,
  values: AgentsWorkflowRuntimeValues
): { ok: true; items: string[] } | { ok: false; code: string; message: string } {
  if (node.iteration.mode === 'fixed') {
    return {
      ok: true,
      items: Array.from({ length: node.iteration.count }, (_, index) => String(index + 1))
    }
  }
  const source = resolveAgentsWorkflowVariable(node.iteration.items, values)
  if (source === null) {
    return { ok: false, code: 'loop_items_missing', message: 'Loop list input is unavailable.' }
  }
  try {
    const parsed: unknown = JSON.parse(source)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      return {
        ok: false,
        code: 'loop_items_invalid',
        message: 'Loop list input must be a JSON string array.'
      }
    }
    if (parsed.length > 20) {
      return {
        ok: false,
        code: 'loop_items_limit',
        message: 'Loop list input exceeds the 20 item limit.'
      }
    }
    return { ok: true, items: parsed }
  } catch {
    return {
      ok: false,
      code: 'loop_items_invalid',
      message: 'Loop list input must be valid JSON.'
    }
  }
}
