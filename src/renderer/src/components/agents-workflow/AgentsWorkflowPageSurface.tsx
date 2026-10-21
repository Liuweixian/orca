import React from 'react'
import { toast } from 'sonner'
import {
  availableVariableRefs,
  validateWorkflowDefinition
} from '../../../../shared/agents-workflow-graph'
import { agentsWorkflowScheduleIssues } from '../../../../shared/agents-workflow-definition-check'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { AgentsWorkflowCanvas } from './agents-workflow-canvas'
import { AgentsWorkflowInspector } from './agents-workflow-inspector'
import { AgentsWorkflowTopBar } from './agents-workflow-top-bar'
import { AgentsWorkflowDefinitionPanel } from './agents-workflow-definition-panel'
import { AgentsWorkflowRunHistory } from './agents-workflow-run-history'
import { describeAgentsWorkflowTarget } from './agents-workflow-target-summary'
import type { AgentsWorkflowPageController } from './use-agents-workflow-page-controller'

export function AgentsWorkflowPageSurface({
  controller
}: {
  controller: AgentsWorkflowPageController
}): React.JSX.Element {
  const definition = controller.definition
  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        {controller.loading ? (
          <div className="text-sm text-muted-foreground">
            {translate('auto.components.agents-workflow.loading', 'Loading workflows…')}
          </div>
        ) : (
          <Button onClick={() => void controller.createWorkflow()}>
            {translate('auto.components.agents-workflow.createFirst', 'Create workflow')}
          </Button>
        )}
      </div>
    )
  }
  return <AgentsWorkflowLoadedSurface controller={controller} definition={definition} />
}

function AgentsWorkflowLoadedSurface({
  controller,
  definition
}: {
  controller: AgentsWorkflowPageController
  definition: AgentsWorkflowDefinition
}): React.JSX.Element {
  const onDefinitionChange = controller.setDefinition
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const targetLabels = React.useMemo(
    () => describeAgentsWorkflowTarget(definition, repos, worktreesByRepo),
    [definition, repos, worktreesByRepo]
  )
  const target = `${targetLabels.host} · ${targetLabels.project} · ${targetLabels.workspace}`
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const issues = React.useMemo(
    // Why include the schedule: the host refuses an unparseable schedule, so the Save button must
    // already be disabled rather than failing after the click.
    () => [
      ...validateWorkflowDefinition(definition),
      ...agentsWorkflowScheduleIssues(definition.trigger.schedule)
    ],
    [definition]
  )
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedIssues = issues.filter((entry) => entry.nodeId === selectedNodeId)
  const selectedAvailableRefs = selectedNode
    ? availableVariableRefs(definition, selectedNode.id)
    : []

  const onSelectNode = React.useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const onNodesRemoved = React.useCallback((ids: Set<string>) => {
    setSelectedNodeId((current) => (current && ids.has(current) ? null : current))
  }, [])

  const exportDefinition = React.useCallback(() => {
    // navigator.clipboard silently rejects in some renderer contexts; the preload bridge
    // routes through Electron's clipboard (or the web fallback) instead.
    void window.api.ui
      .writeClipboardText(JSON.stringify(definition, null, 2))
      .then(() =>
        toast.success(
          translate('auto.components.agents-workflow.exported', 'Workflow JSON copied.')
        )
      )
      .catch(() =>
        toast.error(
          translate('auto.components.agents-workflow.exportFailed', 'Could not copy workflow JSON.')
        )
      )
  }, [definition])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentsWorkflowTopBar
        name={definition.name}
        target={target}
        errorCount={issues.filter((entry) => entry.severity === 'error').length}
        warningCount={issues.filter((entry) => entry.severity === 'warning').length}
        dirty={controller.dirty}
        saving={controller.saving}
        running={controller.running}
        runInput={controller.runInput}
        onSave={() => void controller.saveWorkflow()}
        onDelete={() => setDeleteOpen(true)}
        onRunInputChange={controller.setRunInput}
        onRun={() => void controller.runNow()}
        onExport={exportDefinition}
      />
      {controller.conflict ? (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span>
            {translate(
              'auto.components.agents-workflow.conflict',
              'This workflow changed in another window. Reload it before saving.'
            )}
          </span>
          <Button variant="outline" size="xs" onClick={() => void controller.reloadAfterConflict()}>
            {translate('auto.components.agents-workflow.reload', 'Reload')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <AgentsWorkflowDefinitionPanel
          workflows={controller.workflows}
          definition={definition}
          onSelect={(id) => void controller.selectWorkflow(id)}
          onCreate={() => void controller.createWorkflow()}
          onChange={onDefinitionChange}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AgentsWorkflowCanvas
            definition={definition}
            issues={issues}
            onDefinitionChange={onDefinitionChange}
            onSelectNode={onSelectNode}
            onNodesRemoved={onNodesRemoved}
          />
          <AgentsWorkflowRunHistory
            runs={controller.runs}
            selectedRun={controller.selectedRun}
            hasMore={controller.nextRunsCursor !== null}
            onSelect={(runId) => void controller.selectRun(runId)}
            onLoadMore={() => void controller.loadMoreRuns()}
            onCancel={(runId) => void controller.cancelRun(runId)}
          />
        </div>
        <AgentsWorkflowInspector
          node={selectedNode}
          issues={selectedIssues}
          definition={definition}
          availableRefs={selectedAvailableRefs}
          agentChannel={
            selectedNode?.kind === 'agent'
              ? (controller.agentChannels?.get(selectedNode.agentId) ?? null)
              : null
          }
          onChange={(updated) =>
            onDefinitionChange({
              ...definition,
              nodes: definition.nodes.map((node) => (node.id === updated.id ? updated : node)),
              updatedAt: Date.now()
            })
          }
        />
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.agents-workflow.delete.title', 'Delete workflow?')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.agents-workflow.delete.description',
                'Run history remains available until retention removes it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {translate('auto.components.agents-workflow.delete.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false)
                void controller.deleteWorkflow()
              }}
            >
              {translate('auto.components.agents-workflow.delete.confirm', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
