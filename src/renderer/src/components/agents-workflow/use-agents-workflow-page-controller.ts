import React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { AGENTS_WORKFLOW_REVISION_CONFLICT } from '../../../../shared/agents-workflow-errors'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunSummary
} from '../../../../shared/agents-workflow-run-types'
import {
  useAgentsWorkflowAgentChannels,
  type AgentsWorkflowAgentChannelMap
} from './use-agents-workflow-agent-channels'
import { useAgentsWorkflowInvalidation } from './use-agents-workflow-invalidation'
import { useAgentsWorkflowRuns } from './use-agents-workflow-runs'
import {
  newWorkflowInput,
  workflowTargetForNewWorkflow,
  workflowUpdateFields
} from './agents-workflow-page-inputs'
import { reportDefinitionFailure } from './agents-workflow-definition-errors'
import {
  createAgentsWorkflow,
  deleteAgentsWorkflow,
  listAgentsWorkflows,
  showAgentsWorkflow,
  updateAgentsWorkflow
} from './agents-workflow-rpc-client'

export type AgentsWorkflowPageController = {
  workflows: AgentsWorkflowDefinition[]
  definition: AgentsWorkflowDefinition | null
  runs: AgentsWorkflowRunSummary[]
  selectedRun: AgentsWorkflowRun | null
  nextRunsCursor: string | null
  loading: boolean
  saving: boolean
  running: boolean
  dirty: boolean
  conflict: boolean
  /** What this host can do per agent, or null while it is unknown. */
  agentChannels: AgentsWorkflowAgentChannelMap | null
  setDefinition: (definition: AgentsWorkflowDefinition) => void
  selectWorkflow: (id: string) => Promise<void>
  createWorkflow: () => Promise<void>
  saveWorkflow: () => Promise<void>
  deleteWorkflow: () => Promise<void>
  runNow: () => Promise<void>
  cancelRun: (runId: string) => Promise<void>
  selectRun: (runId: string) => Promise<void>
  loadMoreRuns: () => Promise<void>
  reloadAfterConflict: () => Promise<void>
}

export function useAgentsWorkflowPageController(): AgentsWorkflowPageController {
  const [workflows, setWorkflows] = React.useState<AgentsWorkflowDefinition[]>([])
  const [definition, setDefinitionState] = React.useState<AgentsWorkflowDefinition | null>(null)
  const [savedDefinition, setSavedDefinition] = React.useState<AgentsWorkflowDefinition | null>(
    null
  )
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [conflict, setConflict] = React.useState(false)
  const agentChannels = useAgentsWorkflowAgentChannels()
  const repos = useAppStore((s) => s.repos)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const runsPage = useAgentsWorkflowRuns(savedDefinition?.id ?? null)
  const {
    refreshRuns,
    setSelectedRun,
    clearRuns,
    selectRun,
    cancelRun: cancelRuns,
    loadMoreRuns: loadMoreRunsPage
  } = runsPage

  const selectWorkflow = React.useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const selected = await showAgentsWorkflow(id)
        setDefinitionState(selected)
        setSavedDefinition(selected)
        setConflict(false)
        setSelectedRun(null)
        await refreshRuns(id)
      } catch {
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.loadFailed',
            'Could not load the workflow.'
          )
        )
      } finally {
        setLoading(false)
      }
    },
    [refreshRuns, setSelectedRun]
  )

  const refreshList = React.useCallback(async () => {
    try {
      const next = await listAgentsWorkflows()
      setWorkflows(next)
      return next
    } catch {
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.listFailed',
          'Could not load workflows.'
        )
      )
      return []
    }
  }, [])

  const reloadRun = React.useCallback(
    async (runId: string) => {
      await selectRun(runId)
    },
    [selectRun]
  )

  useAgentsWorkflowInvalidation({
    definitionId: definition?.id ?? null,
    selectedRunId: runsPage.selectedRun?.id ?? null,
    refreshList,
    refreshRuns,
    reloadRun
  })

  React.useEffect(() => {
    let disposed = false
    void refreshList().then(async (next) => {
      if (disposed) {
        return
      }
      const selected = next[0]
      if (selected) {
        await selectWorkflow(selected.id)
      } else {
        setLoading(false)
      }
    })
    return () => {
      disposed = true
    }
  }, [refreshList, selectWorkflow])

  const createWorkflow = React.useCallback(async () => {
    // Why resolve a target first: every workflow needs a project this host can actually run in,
    // and the store refuses ids it cannot resolve.
    const target = workflowTargetForNewWorkflow({
      source: definition,
      repos,
      projectHostSetups,
      worktreesByRepo,
      activeWorktreeId
    })
    if (!target) {
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.noTarget',
          'Open a project workspace before creating a workflow.'
        )
      )
      return
    }
    setSaving(true)
    try {
      const created = await createAgentsWorkflow(newWorkflowInput(definition, target))
      setWorkflows((current) => [created, ...current])
      setDefinitionState(created)
      setSavedDefinition(created)
      clearRuns()
    } catch (error) {
      reportDefinitionFailure(
        error,
        translate(
          'auto.components.agents-workflow.controller.createFailed',
          'Could not create the workflow.'
        )
      )
    } finally {
      setSaving(false)
    }
  }, [activeWorktreeId, clearRuns, definition, projectHostSetups, repos, worktreesByRepo])

  const saveWorkflow = React.useCallback(async () => {
    if (!definition || !savedDefinition) {
      return
    }
    setSaving(true)
    try {
      const saved = await updateAgentsWorkflow(
        savedDefinition.id,
        savedDefinition.revision,
        workflowUpdateFields(definition)
      )
      setDefinitionState(saved)
      setSavedDefinition(saved)
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === saved.id ? saved : workflow))
      )
      setConflict(false)
      toast.success(
        translate('auto.components.agents-workflow.controller.saved', 'Workflow saved.')
      )
    } catch (error) {
      if (
        error instanceof RuntimeRpcCallError &&
        error.code === AGENTS_WORKFLOW_REVISION_CONFLICT
      ) {
        setConflict(true)
      } else {
        reportDefinitionFailure(
          error,
          translate(
            'auto.components.agents-workflow.controller.saveFailed',
            'Could not save the workflow.'
          )
        )
      }
    } finally {
      setSaving(false)
    }
  }, [definition, savedDefinition])

  const deleteWorkflow = React.useCallback(async () => {
    if (!savedDefinition) {
      return
    }
    setSaving(true)
    try {
      await deleteAgentsWorkflow(savedDefinition.id, savedDefinition.revision)
      const next = await refreshList()
      const selected = next[0] ?? null
      if (selected) {
        await selectWorkflow(selected.id)
      } else {
        setDefinitionState(null)
        setSavedDefinition(null)
        clearRuns()
      }
    } catch (error) {
      if (
        error instanceof RuntimeRpcCallError &&
        error.code === AGENTS_WORKFLOW_REVISION_CONFLICT
      ) {
        setConflict(true)
      } else {
        reportDefinitionFailure(
          error,
          translate(
            'auto.components.agents-workflow.controller.deleteFailed',
            'Could not delete the workflow.'
          )
        )
      }
    } finally {
      setSaving(false)
    }
  }, [clearRuns, refreshList, savedDefinition, selectWorkflow])

  const reloadAfterConflict = React.useCallback(async () => {
    if (savedDefinition) {
      await selectWorkflow(savedDefinition.id)
    }
  }, [savedDefinition, selectWorkflow])

  const cancelRun = React.useCallback(
    (runId: string) => cancelRuns(runId, savedDefinition?.id ?? null),
    [cancelRuns, savedDefinition]
  )
  const loadMoreRuns = React.useCallback(
    () => loadMoreRunsPage(savedDefinition?.id ?? null),
    [loadMoreRunsPage, savedDefinition]
  )

  return {
    workflows,
    definition,
    runs: runsPage.runs,
    selectedRun: runsPage.selectedRun,
    nextRunsCursor: runsPage.nextRunsCursor,
    loading,
    saving,
    running: runsPage.running,
    // Why reference equality: every edit path builds a new definition object, and the saved object is
    // the very one held in state, so this is exact without a deep JSON compare on every render.
    dirty: Boolean(definition && savedDefinition && definition !== savedDefinition),
    conflict,
    agentChannels,
    setDefinition: setDefinitionState,
    selectWorkflow,
    createWorkflow,
    saveWorkflow,
    deleteWorkflow,
    runNow: () => runsPage.runNow(savedDefinition?.id ?? ''),
    cancelRun,
    selectRun,
    loadMoreRuns,
    reloadAfterConflict
  }
}
