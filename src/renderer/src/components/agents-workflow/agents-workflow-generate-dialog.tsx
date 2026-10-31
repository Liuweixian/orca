import React from 'react'
import { Sparkles } from 'lucide-react'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { AGENTS_WORKFLOW_GENERATION_REQUEST_LIMIT } from '../../../../shared/agents-workflow-generation'
import {
  agentsWorkflowGenerationBlocker,
  useAgentsWorkflowGenerationAgent
} from './use-agents-workflow-generation-agent'
import type { AgentsWorkflowGenerationRequest } from './use-agents-workflow-generation-run'

/**
 * Collects one request and hands it to the page. The dialog closes on submit: the design turn runs
 * in the background, so keeping a modal open for minutes would only tempt the user into closing it,
 * which is what a modal's close button means.
 */
export function AgentsWorkflowGenerateDialog({
  open,
  onOpenChange,
  definition,
  generating,
  onGenerate
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  definition: AgentsWorkflowDefinition
  /** A turn this page already started is still running; a second one would race it. */
  generating: boolean
  onGenerate: (request: AgentsWorkflowGenerationRequest) => void
}): React.JSX.Element {
  const [prompt, setPrompt] = React.useState('')
  const readiness = useAgentsWorkflowGenerationAgent(definition, {
    // Why only while open: opening the dialog is the user act that may probe this host's agents.
    ensureDetection: open
  })
  const { status: agentStatus, agent, agentIds } = readiness
  /** The user's pick, or null while the dialog follows the agent this workflow resolves to. */
  const [agentChoice, setAgentChoice] = React.useState<TuiAgent | null>(null)
  const selectedAgent = agentChoice !== null && agentIds.includes(agentChoice) ? agentChoice : agent
  // Why keep an unusable current agent in the list: the workflow's own agent is what the trigger
  // shows, so dropping it would render a blank picker instead of explaining why it cannot run.
  const agentOptions = React.useMemo(() => {
    const catalog = getAgentCatalog()
    const usable = catalog.filter((entry) => agentIds.includes(entry.id))
    const current = selectedAgent ? catalog.find((entry) => entry.id === selectedAgent) : undefined
    return current && !usable.some((entry) => entry.id === current.id)
      ? [current, ...usable]
      : usable
  }, [agentIds, selectedAgent])
  const workspaceId =
    definition.workspace.mode === 'existing' ? definition.workspace.workspaceId : null
  // Why the shared blocker: it is what decides whether a request can be sent at all, and it already
  // covers the workspace this graph will run in and the agent the picker resolves to.
  const canGenerate =
    agentsWorkflowGenerationBlocker(definition, readiness) === null && selectedAgent !== null

  const onOpenChangeWithReset = React.useCallback(
    (next: boolean) => {
      if (!next) {
        setPrompt('')
        setAgentChoice(null)
      }
      onOpenChange(next)
    },
    [onOpenChange]
  )

  const submit = React.useCallback(() => {
    const request = prompt.trim()
    if (!request || !workspaceId || !selectedAgent || !canGenerate || generating) {
      return
    }
    onGenerate({
      request,
      workspaceId,
      agentId: selectedAgent,
      agentIds: agentIds.length > 0 ? agentIds : [selectedAgent]
    })
    // Why close here: the turn is the page's now, so the dialog has nothing left to wait for.
    onOpenChangeWithReset(false)
  }, [
    agentIds,
    canGenerate,
    generating,
    onGenerate,
    onOpenChangeWithReset,
    prompt,
    selectedAgent,
    workspaceId
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChangeWithReset}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.agents-workflow.generation.title', 'Generate workflow')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.agents-workflow.generation.description',
              'Describe what the workflow should do. An agent designs the graph in this workflow’s workspace; its chat or terminal closes when it answers, and the finished graph replaces this workflow’s graph and is saved.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-2">
            <Label>
              {translate('auto.components.agents-workflow.generation.agentLabel', 'Agent')}
            </Label>
            <AgentCombobox
              agents={agentOptions}
              value={selectedAgent}
              disabled={generating || agentStatus !== 'ready'}
              onValueChange={setAgentChoice}
              allowNarrowTrigger
              triggerClassName="w-full min-w-0"
            />
          </div>
          <Label htmlFor="agents-workflow-generation-prompt">
            {translate(
              'auto.components.agents-workflow.generation.promptLabel',
              'What should this workflow do?'
            )}
          </Label>
          <Textarea
            id="agents-workflow-generation-prompt"
            autoFocus
            rows={6}
            maxLength={AGENTS_WORKFLOW_GENERATION_REQUEST_LIMIT}
            value={prompt}
            disabled={generating}
            placeholder={translate(
              'auto.components.agents-workflow.generation.promptPlaceholder',
              'For example: review every changed file, fix lint errors, then run the test suite and report failures.'
            )}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {workspaceId ? null : (
            <p className="text-xs text-destructive">
              {translate(
                'auto.components.agents-workflow.generation.workspaceRequired',
                'Generation runs an agent in a workspace. Switch this workflow’s target to a worktree first.'
              )}
            </p>
          )}
          {agentStatus === 'pending' ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.agents-workflow.generation.detecting',
                'Detecting the agents this host can run…'
              )}
            </p>
          ) : null}
          {agentStatus === 'ready' && agent === null ? (
            <p className="text-xs text-destructive">
              {translate(
                'auto.components.agents-workflow.generation.agentRequired',
                'Generation runs an agent. Install or enable an agent for this host first.'
              )}
            </p>
          ) : null}
          {generating ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.agents-workflow.generation.inProgress',
                'A workflow is already being designed. Its graph lands on the canvas and is saved when it answers.'
              )}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button disabled={generating || !prompt.trim() || !canGenerate} onClick={submit}>
            <Sparkles className="size-4" />
            {translate('auto.components.agents-workflow.generation.generate', 'Generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
