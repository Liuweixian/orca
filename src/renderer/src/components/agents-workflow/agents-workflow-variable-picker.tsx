import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { agentsWorkflowVariableRefKey } from '../../../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowVariableRef
} from '../../../../shared/agents-workflow-types'

export function agentsWorkflowVariableLabel(
  ref: AgentsWorkflowVariableRef,
  definition: AgentsWorkflowDefinition
): string {
  if (ref.kind === 'run_input') {
    return translate('auto.components.agents-workflow.inspector.runInput', 'Run input')
  }
  const nodeId = ref.kind === 'node_output' ? ref.nodeId : ref.loopNodeId
  const title = definition.nodes.find((node) => node.id === nodeId)?.title ?? nodeId
  switch (ref.kind) {
    case 'node_output':
      return translate('auto.components.agents-workflow.inspector.nodeOutput', '{{title}} output', {
        title
      })
    case 'loop_item':
      return translate('auto.components.agents-workflow.inspector.loopItem', '{{title}} item', {
        title
      })
    case 'loop_index':
      return translate('auto.components.agents-workflow.inspector.loopIndex', '{{title}} index', {
        title
      })
    case 'loop_output':
      return translate(
        'auto.components.agents-workflow.inspector.loopOutput',
        '{{title}} results',
        {
          title
        }
      )
  }
}

export function AgentsWorkflowVariableSelect({
  value,
  options,
  definition,
  onChange
}: {
  value: AgentsWorkflowVariableRef
  options: AgentsWorkflowVariableRef[]
  definition: AgentsWorkflowDefinition
  onChange: (value: AgentsWorkflowVariableRef) => void
}): React.JSX.Element {
  const selectedKey = agentsWorkflowVariableRefKey(value)
  const choices = options.some((ref) => agentsWorkflowVariableRefKey(ref) === selectedKey)
    ? options
    : [value, ...options]
  return (
    <Select
      value={selectedKey}
      onValueChange={(key) => {
        const selected = choices.find((ref) => agentsWorkflowVariableRefKey(ref) === key)
        if (selected) {
          onChange(selected)
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((ref) => {
          const key = agentsWorkflowVariableRefKey(ref)
          return (
            <SelectItem key={key} value={key}>
              {agentsWorkflowVariableLabel(ref, definition)}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
