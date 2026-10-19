import type { SnapGrid } from '@xyflow/react'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../../../shared/agents-workflow-types'

export type AgentsWorkflowNodeKindToAdd = 'agent' | 'condition' | 'loop'

export const CANVAS_SNAP_GRID: SnapGrid = [16, 16]

export function isFromPort(
  value: string | null | undefined
): value is AgentsWorkflowEdge['fromPort'] {
  return (
    value === 'default' || value === 'yes' || value === 'no' || value === 'each' || value === 'done'
  )
}

export function isToPort(value: string | null | undefined): value is AgentsWorkflowEdge['toPort'] {
  return value === 'default' || value === 'aggregate'
}

export function newNode(
  kind: AgentsWorkflowNodeKindToAdd,
  position: AgentsWorkflowNode['position']
): AgentsWorkflowNode {
  const id = createBrowserUuid()
  if (kind === 'agent') {
    return {
      id,
      kind,
      title: translate('auto.components.agents-workflow.newAgent', 'New agent'),
      position,
      agentId: 'claude',
      prompt: { source: '', bindings: {} },
      terminal: false
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      title: translate('auto.components.agents-workflow.newCondition', 'New condition'),
      position,
      input: { kind: 'run_input' },
      operator: 'contains',
      operand: ''
    }
  }
  return {
    id,
    kind,
    title: translate('auto.components.agents-workflow.newLoop', 'New loop'),
    position,
    iteration: { mode: 'fixed', count: 1 }
  }
}
