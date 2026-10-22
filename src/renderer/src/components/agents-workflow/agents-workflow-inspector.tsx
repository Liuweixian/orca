import AgentCombobox from '@/components/agent/AgentCombobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import type { AgentsWorkflowValidationIssue } from '../../../../shared/agents-workflow-graph'
import type { AgentsWorkflowAgentChannelView } from './agents-workflow-rpc-client'
import { AgentsWorkflowAgentChannelHint } from './agents-workflow-agent-channel-hint'
import type { AgentsWorkflowNode } from '../../../../shared/agents-workflow-types'

export function AgentsWorkflowInspector({
  node,
  terminal,
  issues,
  agentChannel,
  onChange
}: {
  node: AgentsWorkflowNode | null
  /** Whether the node ends the workflow; derived from the graph, because the canvas draws it. */
  terminal: boolean
  issues: AgentsWorkflowValidationIssue[]
  /** What this host can do for the node's agent; null while it is unknown. */
  agentChannel: AgentsWorkflowAgentChannelView | null
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
              <AgentsWorkflowAgentChannelHint channel={agentChannel} terminal={terminal} />
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
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.agents-workflow.inspector.upstreamNote',
                  'The previous node\u2019s answer is saved to a file, and this prompt names that file so the agent reads it first.'
                )}
              </p>
            </div>
          </>
        ) : null}
        {node.kind === 'condition' ? (
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
              <AgentsWorkflowAgentChannelHint channel={agentChannel} terminal={false} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agents-workflow-condition-prompt">
                {translate(
                  'auto.components.agents-workflow.inspector.conditionPrompt',
                  'Judging prompt'
                )}
              </Label>
              <Textarea
                id="agents-workflow-condition-prompt"
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
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.agents-workflow.inspector.conditionDecision',
                  'The agent must answer with {"decision":"yes"} or {"decision":"no"}; anything else fails the run instead of guessing a branch.'
                )}
              </p>
            </div>
          </>
        ) : null}
        {node.kind === 'loop' ? (
          <div className="space-y-2">
            <Label htmlFor="agents-workflow-loop-count">
              {translate('auto.components.agents-workflow.inspector.count', 'Count')}
            </Label>
            <Input
              id="agents-workflow-loop-count"
              type="number"
              min={1}
              max={20}
              value={node.count}
              onChange={(event) => onChange({ ...node, count: Number(event.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.agents-workflow.inspector.loopIterationNote',
                'Each turn writes its iteration number to a file and the body\u2019s prompt reads that file first.'
              )}
            </p>
          </div>
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
