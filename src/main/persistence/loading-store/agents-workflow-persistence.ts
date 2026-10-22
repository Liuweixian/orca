import { randomUUID } from 'node:crypto'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../shared/agents-workflow-types'
import { AgentsWorkflowRunConflictError } from '../../../shared/agents-workflow-errors'
import {
  createAgentsWorkflowDefinition,
  deleteAgentsWorkflowDefinition,
  updateAgentsWorkflowDefinition,
  type AgentsWorkflowDefinitionStore
} from './agents-workflow-definition-store'
import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../../shared/agents-workflow-run-types'
import { agentsWorkflowScheduleRequestKey } from '../../../shared/agents-workflow-run-types'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteFlushBarrierOperations } from './write-flush-barriers'
import {
  isActiveAgentsWorkflowRun,
  isTerminalAgentsWorkflowRun,
  pageAgentsWorkflowRuns,
  retainTerminalAgentsWorkflowRuns
} from './agents-workflow-run-query'

type AgentsWorkflowPersistenceRuntime = Pick<
  StoreRuntimeState,
  'dirtyProfileStateDomains' | 'state'
>

const agentsWorkflowPersistenceContext = Symbol('AgentsWorkflowPersistence')

export class AgentsWorkflowPersistence {
  readonly [agentsWorkflowPersistenceContext]: {
    runtime: AgentsWorkflowPersistenceRuntime
    flushBarriers: WriteFlushBarrierOperations
  }

  constructor(
    runtime: AgentsWorkflowPersistenceRuntime,
    flushBarriers: WriteFlushBarrierOperations
  ) {
    this[agentsWorkflowPersistenceContext] = { runtime, flushBarriers }
  }

  listAgentsWorkflows(): AgentsWorkflowDefinition[] {
    return [...(this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflows ?? [])].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
    )
  }

  showAgentsWorkflow(id: string): AgentsWorkflowDefinition {
    const workflow = (
      this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflows ?? []
    ).find((entry) => entry.id === id)
    if (!workflow) {
      throw new Error('Agent workflow not found.')
    }
    return workflow
  }

  createAgentsWorkflow(input: AgentsWorkflowCreateInput): AgentsWorkflowDefinition {
    return createAgentsWorkflowDefinition(this.definitionStore(), input)
  }

  updateAgentsWorkflow(
    id: string,
    expectedRevision: number,
    updates: AgentsWorkflowUpdateFields
  ): AgentsWorkflowDefinition {
    return updateAgentsWorkflowDefinition(this.definitionStore(), id, expectedRevision, updates)
  }

  deleteAgentsWorkflow(id: string, expectedRevision: number): boolean {
    return deleteAgentsWorkflowDefinition(this.definitionStore(), id, expectedRevision)
  }

  private definitionStore(): AgentsWorkflowDefinitionStore {
    const context = this[agentsWorkflowPersistenceContext]
    return {
      find: (id) => (context.runtime.state.agentsWorkflows ?? []).find((entry) => entry.id === id),
      all: () => context.runtime.state.agentsWorkflows ?? [],
      replace: (next) => {
        context.runtime.state.agentsWorkflows = next
      },
      flush: () => flushAgentsWorkflowDefinitions(this)
    }
  }

  listAgentsWorkflowRuns(input: {
    workflowId?: string
    cursor?: string
    limit: number
  }): AgentsWorkflowRunsPage {
    return pageAgentsWorkflowRuns(
      this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflowRuns ?? [],
      input
    )
  }

  /** The occurrence a schedule already claimed, looked up exactly instead of by list scan. */
  findAgentsWorkflowRunByRequestKey(
    workflowId: string,
    requestKey: string
  ): AgentsWorkflowRun | null {
    return (
      (this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflowRuns ?? []).find(
        (run) => run.workflowId === workflowId && run.requestKey === requestKey
      ) ?? null
    )
  }

  showAgentsWorkflowRun(runId: string): AgentsWorkflowRun {
    const run = (
      this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflowRuns ?? []
    ).find((entry) => entry.id === runId)
    if (!run) {
      throw new Error('Agent workflow run not found.')
    }
    return run
  }

  createAgentsWorkflowRun(input: {
    workflow: AgentsWorkflowDefinition
    requestKey: string
    now: number
    trigger?: 'manual' | 'schedule'
    scheduledFor?: number
  }): { run: AgentsWorkflowRun; created: boolean } {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const runs = runtime.state.agentsWorkflowRuns ?? []
    // Why in memory first: this is the fast path of one desktop process. The SQLite row carries
    // UNIQUE(workflow_id, request_key) as well, but that only guards the write, not the read-modify
    // cycle, so a second process mirroring the same profile still relies on its own in-memory view.
    const duplicate = runs.find(
      (run) => run.workflowId === input.workflow.id && run.requestKey === input.requestKey
    )
    if (duplicate) {
      return { run: duplicate, created: false }
    }
    const workspaceId =
      input.workflow.workspace.mode === 'existing' ? input.workflow.workspace.workspaceId : null
    const conflict = runs.find(
      (run) =>
        isActiveAgentsWorkflowRun(run) &&
        (run.workflowId === input.workflow.id ||
          (workspaceId !== null && run.workspaceId === workspaceId))
    )
    if (conflict) {
      throw new AgentsWorkflowRunConflictError(input.workflow.id, conflict.id, workspaceId)
    }
    const run: AgentsWorkflowRun = {
      schemaVersion: 1,
      id: randomUUID(),
      workflowId: input.workflow.id,
      workflowRevision: input.workflow.revision,
      definitionSnapshot: input.workflow,
      requestKey: input.requestKey,
      trigger: input.trigger ?? 'manual',
      ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor }),
      status: 'pending',
      workspaceId,
      workspaceDisplayName: null,
      attempts: [],
      executionTrace: [],
      createdAt: input.now,
      startedAt: null,
      finishedAt: null
    }
    runtime.state.agentsWorkflowRuns = [...runs, run]
    pruneTerminalRuns(runtime, input.workflow.id)
    flushAgentsWorkflowRuns(this)
    return { run, created: true }
  }

  createSkippedAgentsWorkflowOccurrence(input: {
    workflow: AgentsWorkflowDefinition
    scheduledFor: number
    now: number
    reason: 'active_run' | 'missed_grace'
  }): AgentsWorkflowRun {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const requestKey = agentsWorkflowScheduleRequestKey(input.scheduledFor)
    const existing = (runtime.state.agentsWorkflowRuns ?? []).find(
      (run) => run.workflowId === input.workflow.id && run.requestKey === requestKey
    )
    if (existing) {
      return existing
    }
    const run: AgentsWorkflowRun = {
      schemaVersion: 1,
      id: randomUUID(),
      workflowId: input.workflow.id,
      workflowRevision: input.workflow.revision,
      definitionSnapshot: input.workflow,
      requestKey,
      trigger: 'schedule',
      scheduledFor: input.scheduledFor,
      status: 'skipped',
      workspaceId:
        input.workflow.workspace.mode === 'existing' ? input.workflow.workspace.workspaceId : null,
      workspaceDisplayName: null,
      attempts: [],
      executionTrace: [],
      createdAt: input.now,
      startedAt: null,
      finishedAt: input.now,
      skipReason: input.reason
    }
    runtime.state.agentsWorkflowRuns = [...(runtime.state.agentsWorkflowRuns ?? []), run]
    pruneTerminalRuns(runtime, input.workflow.id)
    flushAgentsWorkflowRuns(this)
    return run
  }

  updateAgentsWorkflowRun(runId: string, updates: Partial<AgentsWorkflowRun>): AgentsWorkflowRun {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const current = this.showAgentsWorkflowRun(runId)
    // Why pin the status: a checkpoint still in flight after a cancel must not rewrite the run
    // back to `running`. A finished run's outcome is final.
    const status =
      updates.status !== undefined && isTerminalAgentsWorkflowRun(current)
        ? current.status
        : updates.status
    const updated: AgentsWorkflowRun = {
      ...current,
      ...updates,
      ...(status === undefined ? {} : { status })
    }
    runtime.state.agentsWorkflowRuns = (runtime.state.agentsWorkflowRuns ?? []).map((run) =>
      run.id === runId ? updated : run
    )
    pruneTerminalRuns(runtime, updated.workflowId)
    flushAgentsWorkflowRuns(this)
    return updated
  }

  replaceAgentsWorkflowRunTrace(
    runId: string,
    attempts: readonly AgentsWorkflowNodeAttempt[],
    executionTrace: readonly string[]
  ): AgentsWorkflowRun {
    // A run that already ended keeps the attempts it ended with; late checkpoints are noise.
    if (isTerminalAgentsWorkflowRun(this.showAgentsWorkflowRun(runId))) {
      return this.showAgentsWorkflowRun(runId)
    }
    return this.updateAgentsWorkflowRun(runId, {
      attempts: attempts.map((attempt) => ({ ...attempt })),
      executionTrace: [...executionTrace]
    })
  }

  markInterruptedAgentsWorkflowRunsUnverifiable(now: number): AgentsWorkflowRun[] {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const interrupted = (runtime.state.agentsWorkflowRuns ?? []).filter(isActiveAgentsWorkflowRun)
    if (interrupted.length === 0) {
      return []
    }
    const ids = new Set(interrupted.map((run) => run.id))
    runtime.state.agentsWorkflowRuns = (runtime.state.agentsWorkflowRuns ?? []).map((run) =>
      ids.has(run.id)
        ? {
            ...run,
            status: 'unverifiable',
            finishedAt: now,
            errorCode: 'execution_evidence_lost',
            errorMessage: 'The app restarted without reliable process-exit evidence.',
            attempts: run.attempts.map((attempt) =>
              attempt.status === 'running' || attempt.status === 'pending'
                ? { ...attempt, status: 'unverifiable', finishedAt: now }
                : attempt
            )
          }
        : run
    )
    flushAgentsWorkflowRuns(this)
    return interrupted.map((run) => this.showAgentsWorkflowRun(run.id))
  }
}

function flushAgentsWorkflowDefinitions(owner: AgentsWorkflowPersistence): void {
  const context = owner[agentsWorkflowPersistenceContext]
  context.runtime.dirtyProfileStateDomains?.add('agentsWorkflows')
  context.flushBarriers.flush()
}

function flushAgentsWorkflowRuns(owner: AgentsWorkflowPersistence): void {
  const context = owner[agentsWorkflowPersistenceContext]
  context.runtime.dirtyProfileStateDomains?.add('agentsWorkflowRuns')
  context.flushBarriers.flush()
}

function pruneTerminalRuns(runtime: AgentsWorkflowPersistenceRuntime, workflowId: string): void {
  runtime.state.agentsWorkflowRuns = retainTerminalAgentsWorkflowRuns(
    runtime.state.agentsWorkflowRuns ?? [],
    workflowId
  )
}
