import AgentCombobox from '@/components/agent/AgentCombobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import {
  agentsWorkflowVariableRefKey,
  type AgentsWorkflowValidationIssue
} from '../../../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowNode,
  AgentsWorkflowPrompt,
  AgentsWorkflowVariableRef
} from '../../../../shared/agents-workflow-types'

function nextBindingKey(ref: AgentsWorkflowVariableRef, prompt: AgentsWorkflowPrompt): string {
  const base =
    ref.kind === 'run_input'
      ? 'input'
      : ref.kind === 'node_output'
        ? `node_${ref.nodeId}`
        : `${ref.kind}_${ref.loopNodeId}`
  let candidate = base.replaceAll(/[^a-zA-Z0-9_]/g, '_')
  let suffix = 2
  while (prompt.bindings[candidate]) {
    candidate = `${base}_${suffix}`.replaceAll(/[^a-zA-Z0-9_]/g, '_')
    suffix += 1
  }
  return candidate
}

function refLabel(ref: AgentsWorkflowVariableRef, definition: AgentsWorkflowDefinition): string {
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

function VariableSelect({
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
              {refLabel(ref, definition)}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export function AgentsWorkflowInspector({
  node,
  issues,
  definition,
  availableRefs,
  onChange
}: {
  node: AgentsWorkflowNode | null
  issues: AgentsWorkflowValidationIssue[]
  definition: AgentsWorkflowDefinition
  availableRefs: AgentsWorkflowVariableRef[]
  onChange: (node: AgentsWorkflowNode) => void
}): React.JSX.Element {
  if (!node) {
    return (
      <aside className="w-72 shrink-0 border-l border-border bg-card p-4 text-sm text-muted-foreground">
        {translate(
          'auto.components.agents-workflow.inspector.empty',
          'Select a node to edit its settings.'
        )}
      </aside>
    )
  }
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-card p-4 scrollbar-sleek">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="agents-workflow-node-title">
            {translate('auto.components.agents-workflow.inspector.title', 'Title')}
          </Label>
          <Input
            id="agents-workflow-node-title"
            value={node.title}
            onChange={(event) => onChange({ ...node, title: event.target.value })}
          />
        </div>
        {node.kind === 'agent' ? (
          <>
            <div className="space-y-2">
              <Label>{translate('auto.components.agents-workflow.inspector.agent', 'Agent')}</Label>
              <AgentCombobox
                agents={getAgentCatalog()}
                value={node.agentId}
                onValueChange={(agentId) => onChange({ ...node, agentId })}
                allowNarrowTrigger
                triggerClassName="w-full min-w-0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agents-workflow-node-prompt">
                {translate('auto.components.agents-workflow.inspector.prompt', 'Prompt')}
              </Label>
              <Textarea
                id="agents-workflow-node-prompt"
                variant="code"
                className="min-h-32"
                value={node.prompt.source}
                onChange={(event) =>
                  onChange({
                    ...node,
                    prompt: { ...node.prompt, source: event.target.value }
                  })
                }
              />
              <Select
                onValueChange={(key) => {
                  const ref = availableRefs.find(
                    (candidate) => agentsWorkflowVariableRefKey(candidate) === key
                  )
                  if (!ref) {
                    return
                  }
                  const bindingKey = nextBindingKey(ref, node.prompt)
                  onChange({
                    ...node,
                    prompt: {
                      source: `${node.prompt.source}{{binding:${bindingKey}}}`,
                      bindings: { ...node.prompt.bindings, [bindingKey]: ref }
                    }
                  })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={translate(
                      'auto.components.agents-workflow.inspector.insertVariable',
                      'Insert variable'
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableRefs.map((ref) => {
                    const key = agentsWorkflowVariableRefKey(ref)
                    return (
                      <SelectItem key={key} value={key}>
                        {refLabel(ref, definition)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agents-workflow-node-args">
                {translate(
                  'auto.components.agents-workflow.inspector.extraArgs',
                  'Extra agent arguments'
                )}
              </Label>
              <Input
                id="agents-workflow-node-args"
                value={node.extraAgentArgs ?? ''}
                onChange={(event) =>
                  onChange({ ...node, extraAgentArgs: event.target.value || undefined })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="agents-workflow-node-terminal">
                {translate('auto.components.agents-workflow.inspector.terminal', 'Terminal node')}
              </Label>
              <Switch
                id="agents-workflow-node-terminal"
                checked={node.terminal}
                onCheckedChange={(terminal) => onChange({ ...node, terminal })}
              />
            </div>
          </>
        ) : null}
        {node.kind === 'condition' ? (
          <>
            <div className="space-y-2">
              <Label>{translate('auto.components.agents-workflow.inspector.input', 'Input')}</Label>
              <VariableSelect
                value={node.input}
                options={availableRefs}
                definition={definition}
                onChange={(input) => onChange({ ...node, input })}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {translate('auto.components.agents-workflow.inspector.operator', 'Operator')}
              </Label>
              <Select
                value={node.operator}
                onValueChange={(operator) => {
                  if (
                    operator === 'contains' ||
                    operator === 'not_contains' ||
                    operator === 'empty' ||
                    operator === 'not_empty' ||
                    operator === 'length_gte'
                  ) {
                    onChange({ ...node, operator })
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">
                    {translate('auto.components.agents-workflow.inspector.contains', 'Contains')}
                  </SelectItem>
                  <SelectItem value="not_contains">
                    {translate(
                      'auto.components.agents-workflow.inspector.notContains',
                      'Does not contain'
                    )}
                  </SelectItem>
                  <SelectItem value="empty">
                    {translate(
                      'auto.components.agents-workflow.inspector.emptyOperator',
                      'Is empty'
                    )}
                  </SelectItem>
                  <SelectItem value="not_empty">
                    {translate(
                      'auto.components.agents-workflow.inspector.notEmpty',
                      'Is not empty'
                    )}
                  </SelectItem>
                  <SelectItem value="length_gte">
                    {translate(
                      'auto.components.agents-workflow.inspector.lengthAtLeast',
                      'Length at least'
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {node.operator === 'contains' ||
            node.operator === 'not_contains' ||
            node.operator === 'length_gte' ? (
              <div className="space-y-2">
                <Label htmlFor="agents-workflow-node-operand">
                  {translate('auto.components.agents-workflow.inspector.operand', 'Value')}
                </Label>
                <Input
                  id="agents-workflow-node-operand"
                  value={node.operand ?? ''}
                  onChange={(event) => onChange({ ...node, operand: event.target.value })}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {node.kind === 'loop' ? (
          <>
            <div className="space-y-2">
              <Label>
                {translate('auto.components.agents-workflow.inspector.loopMode', 'Iteration mode')}
              </Label>
              <Select
                value={node.iteration.mode}
                onValueChange={(mode) => {
                  if (mode === 'fixed') {
                    onChange({ ...node, iteration: { mode, count: 1 } })
                  } else if (mode === 'list') {
                    onChange({
                      ...node,
                      iteration: { mode, items: availableRefs[0] ?? { kind: 'run_input' } }
                    })
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">
                    {translate(
                      'auto.components.agents-workflow.inspector.fixedCount',
                      'Fixed count'
                    )}
                  </SelectItem>
                  <SelectItem value="list">
                    {translate('auto.components.agents-workflow.inspector.jsonList', 'JSON list')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {node.iteration.mode === 'fixed' ? (
              <div className="space-y-2">
                <Label htmlFor="agents-workflow-loop-count">
                  {translate('auto.components.agents-workflow.inspector.count', 'Count')}
                </Label>
                <Input
                  id="agents-workflow-loop-count"
                  type="number"
                  min={1}
                  max={20}
                  value={node.iteration.count}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      iteration: { mode: 'fixed', count: Number(event.target.value) }
                    })
                  }
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>
                  {translate('auto.components.agents-workflow.inspector.items', 'Items')}
                </Label>
                <VariableSelect
                  value={node.iteration.items}
                  options={availableRefs}
                  definition={definition}
                  onChange={(items) => onChange({ ...node, iteration: { mode: 'list', items } })}
                />
              </div>
            )}
          </>
        ) : null}
        {issues.length > 0 ? (
          <section className="space-y-2">
            <div className="text-xs font-semibold text-destructive">
              {translate('auto.components.agents-workflow.inspector.issues', 'Issues')}
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {issues.map((entry) => (
                <li key={`${entry.code}:${entry.edgeId ?? ''}:${entry.message}`}>
                  {entry.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  )
}
