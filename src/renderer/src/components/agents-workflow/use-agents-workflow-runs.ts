import React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunSummary
} from '../../../../shared/agents-workflow-run-types'
import {
  cancelAgentsWorkflowRun,
  listAgentsWorkflowRuns,
  runAgentsWorkflow,
  showAgentsWorkflowRun
} from './agents-workflow-rpc-client'

export const RUN_PAGE_SIZE = 20
/** Only while a run is active: notifications are the fast path, this is the safety net. */
const ACTIVE_RUN_POLL_MS = 5_000

function isActiveRunStatus(status: AgentsWorkflowRunSummary['status']): boolean {
  return status === 'pending' || status === 'running' || status === 'cancel_requested'
}

export type AgentsWorkflowRunsState = {
  runs: AgentsWorkflowRunSummary[]
  selectedRun: AgentsWorkflowRun | null
  nextRunsCursor: string | null
  running: boolean
  setSelectedRun: (run: AgentsWorkflowRun | null) => void
  refreshRuns: (workflowId: string) => Promise<void>
  clearRuns: () => void
  selectRun: (runId: string) => Promise<void>
  runNow: (workflowId: string) => Promise<void>
  cancelRun: (runId: string, workflowId: string | null) => Promise<void>
  loadMoreRuns: (workflowId: string | null) => Promise<void>
}

/** The run history a workflow page shows: the newest page, its detail, and paging. */
export function useAgentsWorkflowRuns(workflowId: string | null): AgentsWorkflowRunsState {
  const [runs, setRuns] = React.useState<AgentsWorkflowRunSummary[]>([])
  const [selectedRun, setSelectedRun] = React.useState<AgentsWorkflowRun | null>(null)
  const [nextRunsCursor, setNextRunsCursor] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)

  const refreshRuns = React.useCallback(async (workflowId: string) => {
    try {
      const page = await listAgentsWorkflowRuns({ workflowId, limit: RUN_PAGE_SIZE })
      setRuns(page.runs)
      setNextRunsCursor(page.nextCursor)
      setSelectedRun((current) =>
        current && page.runs.some((run) => run.id === current.id) ? current : null
      )
    } catch {
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.runsLoadFailed',
          'Could not load the run history.'
        )
      )
    }
  }, [])

  const clearRuns = React.useCallback(() => {
    setRuns([])
    setNextRunsCursor(null)
    setSelectedRun(null)
  }, [])

  /** Starts a run, then shows it: the page never waits for the agent's first node. */
  const runNow = React.useCallback(
    async (workflowId: string) => {
      if (!workflowId) {
        return
      }
      setRunning(true)
      try {
        const run = await runAgentsWorkflow(workflowId, createBrowserUuid())
        await refreshRuns(workflowId)
        setSelectedRun(run)
      } catch {
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.runFailed',
            'Could not start the workflow.'
          )
        )
      } finally {
        setRunning(false)
      }
    },
    [refreshRuns]
  )

  const selectRun = React.useCallback(async (runId: string) => {
    try {
      setSelectedRun(await showAgentsWorkflowRun(runId))
    } catch {
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.runLoadFailed',
          'Could not load the run.'
        )
      )
    }
  }, [])

  const cancelRun = React.useCallback(
    async (runId: string, workflowId: string | null) => {
      try {
        setSelectedRun(await cancelAgentsWorkflowRun(runId))
        if (workflowId) {
          await refreshRuns(workflowId)
        }
      } catch {
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.cancelFailed',
            'Could not cancel the run.'
          )
        )
      }
    },
    [refreshRuns]
  )

  const loadMoreRuns = React.useCallback(
    async (workflowId: string | null) => {
      if (!workflowId || !nextRunsCursor) {
        return
      }
      try {
        const page = await listAgentsWorkflowRuns({
          workflowId,
          cursor: nextRunsCursor,
          limit: RUN_PAGE_SIZE
        })
        // A cursor whose run was pruned comes back empty: appending nothing beats duplicating rows.
        setRuns((current) => [...current, ...page.runs])
        setNextRunsCursor(page.nextCursor)
      } catch {
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.runsLoadFailed',
            'Could not load the run history.'
          )
        )
      }
    },
    [nextRunsCursor]
  )

  // Why a poll at all: a dropped notification (or a window reload) would otherwise leave the
  // detail view showing `running` forever. It stops as soon as nothing is active.
  const selectedRunIdRef = React.useRef<string | null>(null)
  selectedRunIdRef.current = selectedRun?.id ?? null
  const hasActiveRun =
    runs.some((run) => isActiveRunStatus(run.status)) ||
    (selectedRun !== null && isActiveRunStatus(selectedRun.status))
  React.useEffect(() => {
    if (!workflowId || !hasActiveRun) {
      return
    }
    const timer = setInterval(() => {
      void refreshRuns(workflowId)
      const runId = selectedRunIdRef.current
      if (runId) {
        void showAgentsWorkflowRun(runId)
          .then(setSelectedRun)
          .catch(() => undefined)
      }
    }, ACTIVE_RUN_POLL_MS)
    return () => clearInterval(timer)
  }, [hasActiveRun, refreshRuns, workflowId])

  return {
    runs,
    selectedRun,
    nextRunsCursor,
    running,
    setSelectedRun,
    runNow,
    refreshRuns,
    clearRuns,
    selectRun,
    cancelRun,
    loadMoreRuns
  }
}
