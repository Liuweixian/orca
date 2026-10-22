import type { SnapGrid } from '@xyflow/react'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import {
  AGENTS_WORKFLOW_DECISION_NO,
  AGENTS_WORKFLOW_DECISION_YES
} from '../../../../shared/agents-workflow-decision'
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
      prompt: { source: '' }
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      title: translate('auto.components.agents-workflow.newCondition', 'New condition'),
      position,
      agentId: 'claude',
      prompt: {
        source: translate(
          'auto.components.agents-workflow.conditionPromptTemplate',
          'Read the answer this node inherits, then decide whether it meets this condition:\n\n<write the condition here>\n\nAnswer with a single JSON object and nothing else: {{yes}} when the condition holds, {{no}} when it does not.',
          { yes: AGENTS_WORKFLOW_DECISION_YES, no: AGENTS_WORKFLOW_DECISION_NO }
        )
      }
    }
  }
  return {
    id,
    kind,
    title: translate('auto.components.agents-workflow.newLoop', 'New loop'),
    position,
    count: 1
  }
}
