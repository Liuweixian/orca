import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, RefreshCw, SquareArrowOutUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { agentsWorkflowDefinitionErrors } from '../../../../shared/agents-workflow-definition-check'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { describeAgentsWorkflowTarget } from '../agents-workflow/agents-workflow-target-summary'
import { listAgentsWorkflows } from '../agents-workflow/agents-workflow-rpc-client'
import { runAgentsWorkflowWithToast } from '../agents-workflow/agents-workflow-run-start'
import { useAgentsWorkflowInvalidation } from '../agents-workflow/use-agents-workflow-invalidation'

// Why module-level: the invalidation hook keys its subscription on these callbacks; a fresh
// closure per render would resubscribe on every state change of this panel.
const noopRefreshRuns = async (): Promise<void> => {}
const noopReloadRun = async (): Promise<void> => {}

export default function AgentsWorkflowSidebarPanel(): React.JSX.Element {
  const repoId = useAppStore((s) => {
    const worktreeId = s.activeWorktreeId
    return worktreeId ? (s.getKnownWorktreeById(worktreeId)?.repoId ?? null) : null
  })
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const openAgentsWorkflowPage = useAppStore((s) => s.openAgentsWorkflowPage)
  const openAgentsWorkflowPageOn = useAppStore((s) => s.openAgentsWorkflowPageOn)
  const [workflows, setWorkflows] = useState<AgentsWorkflowDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    setLoading(true)
    try {
      setWorkflows(await listAgentsWorkflows())
      setLoadFailed(false)
    } catch {
      // Why: a failed list must not read as "this project has no workflows".
      setLoadFailed(true)
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.listFailed',
          'Could not load workflows.'
        )
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useAgentsWorkflowInvalidation({
    definitionId: null,
    selectedRunId: null,
    refreshList,
    refreshRuns: noopRefreshRuns,
    reloadRun: noopReloadRun
  })

  const visibleWorkflows = useMemo(() => {
    if (!repoId) {
      return []
    }
    // Why by repo and not by worktree id: a workflow bound to `new_per_run` names no worktree at
    // all, and one bound to a sibling worktree still belongs to the same project.
    return workflows
      .filter((workflow) => workflow.runContext.repoId === repoId)
      .map((workflow) => ({
        workflow,
        // Why: the canvas blocks Run on an invalid graph and the host does not re-check before it
        // creates the workspace, so running from here would build a worktree just to fail.
        errorCount: agentsWorkflowDefinitionErrors(workflow).length,
        // Why the shared helper: the canvas subtitle and this one must not describe the same
        // target differently.
        workspace: describeAgentsWorkflowTarget(workflow, repos, worktreesByRepo).workspace
      }))
  }, [repoId, repos, workflows, worktreesByRepo])

  const runWorkflow = useCallback(async (workflowId: string) => {
    setRunningId(workflowId)
    try {
      const run = await runAgentsWorkflowWithToast(workflowId)
      if (run) {
        toast.success(
          translate(
            'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.runStarted',
            'Workflow run started.'
          )
        )
      }
    } finally {
      setRunningId(null)
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">
            {translate('auto.components.right.sidebar.index.workflows', 'Workflows')}
          </div>
          {visibleWorkflows.length > 0 ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {translate(
                'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.count',
                '{{value0}} in this project',
                { value0: visibleWorkflows.length }
              )}
            </div>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void refreshList()}
              disabled={loading}
              aria-label={translate(
                'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.refresh',
                'Refresh workflows'
              )}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {translate(
              'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.refresh',
              'Refresh workflows'
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      {visibleWorkflows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-sm font-medium text-foreground">
            {loading
              ? translate('auto.components.agents-workflow.loading', 'Loading workflows…')
              : loadFailed
                ? translate(
                    'auto.components.agents-workflow.controller.listFailed',
                    'Could not load workflows.'
                  )
                : translate(
                    'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.emptyTitle',
                    'No workflows for this project'
                  )}
          </div>
          {loading || loadFailed ? null : (
            <>
              <div className="mt-2 max-w-[16rem] text-xs leading-5 text-muted-foreground">
                {translate(
                  'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.emptyCopy',
                  'Create a workflow in the Workflows page and it will show up here.'
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="mt-3"
                onClick={openAgentsWorkflowPage}
              >
                {translate(
                  'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.openPage',
                  'Open Workflows page'
                )}
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 py-1">
            <div className="space-y-0.5">
              {visibleWorkflows.map(({ workflow, errorCount, workspace }) => (
                <div
                  key={workflow.id}
                  className="group flex items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-sidebar-accent/55"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {workflow.name}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{workspace}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => openAgentsWorkflowPageOn(workflow.id)}
                          aria-label={translate(
                            'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.openWorkflow',
                            'Open {{value0}}',
                            { value0: workflow.name }
                          )}
                        >
                          <SquareArrowOutUpRight className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        {translate(
                          'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.openWorkflow',
                          'Open {{value0}}',
                          { value0: workflow.name }
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void runWorkflow(workflow.id)}
                          disabled={runningId !== null || errorCount > 0}
                          aria-label={translate(
                            'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.run',
                            'Run {{value0}}',
                            { value0: workflow.name }
                          )}
                        >
                          <Play
                            className={cn('size-3.5', runningId === workflow.id && 'animate-pulse')}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        {errorCount > 0
                          ? translate(
                              'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.runBlocked',
                              'Fix this workflow’s issues before running it.'
                            )
                          : translate(
                              'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.run',
                              'Run {{value0}}',
                              { value0: workflow.name }
                            )}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-sidebar-border px-2 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={openAgentsWorkflowPage}
            >
              {translate(
                'auto.components.rightSidebar.AgentsWorkflowSidebarPanel.openPage',
                'Open Workflows page'
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
