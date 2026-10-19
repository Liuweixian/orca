import React from 'react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { AGENTS_WORKFLOW_REVISION_CONFLICT } from '../../../../shared/agents-workflow-errors'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunSummary
} from '../../../../shared/agents-workflow-run-types'
import { subscribeAgentsWorkflowAuthorityInvalidation } from '@/lib/agents-workflow-authority-invalidation'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import {
  cancelAgentsWorkflowRun,
  createAgentsWorkflow,
  deleteAgentsWorkflow,
  listAgentsWorkflowRuns,
  listAgentsWorkflows,
  runAgentsWorkflow,
  showAgentsWorkflow,
  showAgentsWorkflowRun,
  updateAgentsWorkflow
} from './agents-workflow-rpc-client'

const RUN_PAGE_SIZE = 20

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
  runInput: string
  setDefinition: (definition: AgentsWorkflowDefinition) => void
  setRunInput: (input: string) => void
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
  const [runs, setRuns] = React.useState<AgentsWorkflowRunSummary[]>([])
  const [selectedRun, setSelectedRun] = React.useState<AgentsWorkflowRun | null>(null)
  const [nextRunsCursor, setNextRunsCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [conflict, setConflict] = React.useState(false)
  const [runInput, setRunInput] = React.useState('')

  const refreshRuns = React.useCallback(async (workflowId: string) => {
    const page = await listAgentsWorkflowRuns({ workflowId, limit: RUN_PAGE_SIZE })
    setRuns(page.runs)
    setNextRunsCursor(page.nextCursor)
    setSelectedRun((current) => {
      if (!current) {
        return current
      }
      return page.runs.some((run) => run.id === current.id) ? current : null
    })
  }, [])

  const selectWorkflow = React.useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const selected = await showAgentsWorkflow(id)
        setDefinitionState(selected)
        setSavedDefinition(selected)
        setRunInput(selected.trigger.defaultInput)
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
    [refreshRuns]
  )

  const refreshList = React.useCallback(async () => {
    const next = await listAgentsWorkflows()
    setWorkflows(next)
    return next
  }, [])

  const definitionIdRef = React.useRef<string | null>(null)
  const selectedRunIdRef = React.useRef<string | null>(null)
  definitionIdRef.current = definition?.id ?? null
  selectedRunIdRef.current = selectedRun?.id ?? null

  React.useEffect(() => {
    let disposed = false
    void refreshList()
      .then(async (next) => {
        if (disposed) {
          return
        }
        const preferred = definitionIdRef.current
        const selected = next.find((workflow) => workflow.id === preferred) ?? next[0]
        if (selected) {
          await selectWorkflow(selected.id)
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        setLoading(false)
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.listFailed',
            'Could not load workflows.'
          )
        )
      })
    const unsubscribe = subscribeAgentsWorkflowAuthorityInvalidation((authority) => {
      if (authority.kind !== 'desktop') {
        return
      }
      void refreshList()
      const workflowId = definitionIdRef.current
      const runId = selectedRunIdRef.current
      if (workflowId) {
        void refreshRuns(workflowId)
      }
      if (runId) {
        void showAgentsWorkflowRun(runId)
          .then(setSelectedRun)
          .catch(() => undefined)
      }
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [refreshList, refreshRuns, selectWorkflow])

  const createWorkflow = React.useCallback(async () => {
    setSaving(true)
    try {
      const created = await createAgentsWorkflow(newWorkflowInput(definition))
      setWorkflows((current) => [created, ...current])
      setDefinitionState(created)
      setSavedDefinition(created)
      setRunInput(created.trigger.defaultInput)
      setRuns([])
      setNextRunsCursor(null)
      setSelectedRun(null)
    } catch {
      toast.error(
        translate(
          'auto.components.agents-workflow.controller.createFailed',
          'Could not create the workflow.'
        )
      )
    } finally {
      setSaving(false)
    }
  }, [definition])

  const saveWorkflow = React.useCallback(async () => {
    if (!definition || !savedDefinition) {
      return
    }
    setSaving(true)
    try {
      const saved = await updateAgentsWorkflow(
        savedDefinition.id,
        savedDefinition.revision,
        updateFields(definition)
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
        toast.error(
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
        setRuns([])
        setSelectedRun(null)
      }
    } catch (error) {
      if (
        error instanceof RuntimeRpcCallError &&
        error.code === AGENTS_WORKFLOW_REVISION_CONFLICT
      ) {
        setConflict(true)
      } else {
        toast.error(
          translate(
            'auto.components.agents-workflow.controller.deleteFailed',
            'Could not delete the workflow.'
          )
        )
      }
    } finally {
      setSaving(false)
    }
  }, [refreshList, savedDefinition, selectWorkflow])

  const runNow = React.useCallback(async () => {
    if (!savedDefinition) {
      return
    }
    setRunning(true)
    try {
      const run = await runAgentsWorkflow(savedDefinition.id, runInput, createBrowserUuid())
      await refreshRuns(savedDefinition.id)
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
  }, [refreshRuns, runInput, savedDefinition])

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
    async (runId: string) => {
      const cancelled = await cancelAgentsWorkflowRun(runId)
      setSelectedRun(cancelled)
      if (savedDefinition) {
        await refreshRuns(savedDefinition.id)
      }
    },
    [refreshRuns, savedDefinition]
  )

  const loadMoreRuns = React.useCallback(async () => {
    if (!savedDefinition || !nextRunsCursor) {
      return
    }
    const page = await listAgentsWorkflowRuns({
      workflowId: savedDefinition.id,
      cursor: nextRunsCursor,
      limit: RUN_PAGE_SIZE
    })
    setRuns((current) => [...current, ...page.runs])
    setNextRunsCursor(page.nextCursor)
  }, [nextRunsCursor, savedDefinition])

  const reloadAfterConflict = React.useCallback(async () => {
    if (savedDefinition) {
      await selectWorkflow(savedDefinition.id)
    }
  }, [savedDefinition, selectWorkflow])

  return {
    workflows,
    definition,
    runs,
    selectedRun,
    nextRunsCursor,
    loading,
    saving,
    running,
    dirty: Boolean(
      definition &&
      savedDefinition &&
      JSON.stringify(definition) !== JSON.stringify(savedDefinition)
    ),
    conflict,
    runInput,
    setDefinition: setDefinitionState,
    setRunInput,
    selectWorkflow,
    createWorkflow,
    saveWorkflow,
    deleteWorkflow,
    runNow,
    cancelRun,
    selectRun,
    loadMoreRuns,
    reloadAfterConflict
  }
}

function newWorkflowInput(source: AgentsWorkflowDefinition | null): AgentsWorkflowCreateInput {
  const template = source ?? createAgentsWorkflowPageFixture()
  const {
    id: _id,
    revision: _revision,
    schedulerOwner: _schedulerOwner,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = template
  return {
    ...input,
    creationKey: createBrowserUuid(),
    name: translate('auto.components.agents-workflow.controller.newName', 'New workflow'),
    trigger: { ...input.trigger, schedule: null }
  }
}

function updateFields(definition: AgentsWorkflowDefinition): AgentsWorkflowUpdateFields {
  return {
    schemaVersion: definition.schemaVersion,
    name: definition.name,
    nodes: definition.nodes,
    edges: definition.edges,
    runContext: definition.runContext,
    workspace: definition.workspace,
    trigger: definition.trigger,
    enabled: definition.enabled
  }
}
