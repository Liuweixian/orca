import React from 'react'
import { toast } from 'sonner'
import { agentsWorkflowNodeFeedsEnd } from '../../../../shared/agents-workflow-graph-analysis'
import { agentsWorkflowDefinitionIssues } from '../../../../shared/agents-workflow-definition-check'
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
  const pendingWorkflowId = useAppStore((s) => s.pendingAgentsWorkflowDefinitionId)
  const setPendingWorkflowId = useAppStore((s) => s.setPendingAgentsWorkflowDefinitionId)
  const targetLabels = React.useMemo(
    () => describeAgentsWorkflowTarget(definition, repos, worktreesByRepo),
    [definition, repos, worktreesByRepo]
  )
  const target = `${targetLabels.host} · ${targetLabels.project} · ${targetLabels.workspace}`
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [clearHistoryOpen, setClearHistoryOpen] = React.useState(false)
  /** A switch that would silently drop unsaved edits, held until the user confirms. */
  const [pendingDiscard, setPendingDiscard] = React.useState<
    { kind: 'select'; id: string } | { kind: 'create' } | null
  >(null)
  const issues = React.useMemo(
    // Why the shared helper: the host refuses a write on the same schedule errors, so "why is Run
    // disabled" must be computed exactly the way the host computes it.
    () => agentsWorkflowDefinitionIssues(definition),
    [definition]
  )
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedIssues = issues.filter((entry) => entry.nodeId === selectedNodeId)
  const selectedTerminal =
    selectedNode !== null && agentsWorkflowNodeFeedsEnd(definition, selectedNode.id)

  const onSelectNode = React.useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const onNodesRemoved = React.useCallback((ids: Set<string>) => {
    setSelectedNodeId((current) => (current && ids.has(current) ? null : current))
  }, [])

  const requestSwitch = React.useCallback(
    (next: { kind: 'select'; id: string } | { kind: 'create' }) => {
      if (controller.dirty) {
        setPendingDiscard(next)
        return
      }
      void (next.kind === 'select'
        ? controller.selectWorkflow(next.id)
        : controller.createWorkflow())
    },
    [controller]
  )

  // Why here: the page stays mounted while the right sidebar is open, so a row clicked there
  // arrives as a store change. Reusing requestSwitch keeps the unsaved-edits guard in one place.
  React.useEffect(() => {
    if (!pendingWorkflowId) {
      return
    }
    setPendingWorkflowId(null)
    if (pendingWorkflowId !== definition.id) {
      requestSwitch({ kind: 'select', id: pendingWorkflowId })
    }
  }, [definition.id, pendingWorkflowId, requestSwitch, setPendingWorkflowId])

  const confirmDiscard = React.useCallback(() => {
    const pending = pendingDiscard
    setPendingDiscard(null)
    if (!pending) {
      return
    }
    void (pending.kind === 'select'
      ? controller.selectWorkflow(pending.id)
      : controller.createWorkflow())
  }, [controller, pendingDiscard])

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
        onSave={() => void controller.saveWorkflow()}
        onDelete={() => setDeleteOpen(true)}
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
          issues={issues}
          onSelect={(id) => requestSwitch({ kind: 'select', id })}
          onCreate={() => requestSwitch({ kind: 'create' })}
          onDelete={() => setDeleteOpen(true)}
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
            onClearHistory={() => setClearHistoryOpen(true)}
          />
        </div>
        <AgentsWorkflowInspector
          node={selectedNode}
          terminal={selectedTerminal}
          issues={selectedIssues}
          agentChannel={
            selectedNode && (selectedNode.kind === 'agent' || selectedNode.kind === 'condition')
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
                'The workflow and its run history are deleted. Workspaces created by previous runs are left in place.'
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
      <Dialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.agents-workflow.history.clearTitle',
                'Clear run history?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.agents-workflow.history.clearDescription',
                'Finished runs of this workflow are deleted. A run that is still active is kept until it ends.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClearHistoryOpen(false)}>
              {translate('auto.components.agents-workflow.history.clearCancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setClearHistoryOpen(false)
                void controller.clearRunHistory()
              }}
            >
              {translate('auto.components.agents-workflow.history.clearConfirm', 'Clear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDiscard(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.agents-workflow.discard.title',
                'Discard unsaved changes?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.agents-workflow.discard.description',
                'This workflow has edits that were not saved. Switching now loses them.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDiscard(null)}>
              {translate('auto.components.agents-workflow.discard.cancel', 'Keep editing')}
            </Button>
            <Button variant="destructive" onClick={confirmDiscard}>
              {translate('auto.components.agents-workflow.discard.confirm', 'Discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
