import { randomUUID } from 'node:crypto'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../shared/agents-workflow-types'
import {
  AgentsWorkflowRevisionConflictError,
  AgentsWorkflowRunConflictError
} from '../../../shared/agents-workflow-errors'
import type {
  AgentsWorkflowNodeAttempt,
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage,
  AgentsWorkflowRunSummary
} from '../../../shared/agents-workflow-run-types'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteFlushBarrierOperations } from './write-flush-barriers'

type AgentsWorkflowPersistenceRuntime = Pick<
  StoreRuntimeState,
  'dirtyProfileStateDomains' | 'state'
>
const TERMINAL_RUN_RETENTION_PER_WORKFLOW = 100

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
    if (input.creationKey) {
      const existing = (
        this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflows ?? []
      ).find((entry) => entry.creationKey === input.creationKey)
      if (existing) {
        return existing
      }
    }
    const now = Date.now()
    const workflow: AgentsWorkflowDefinition = {
      ...input,
      id: randomUUID(),
      revision: 1,
      schedulerOwner: 'local_host_service',
      createdAt: now,
      updatedAt: now
    }
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    runtime.state.agentsWorkflows = [...(runtime.state.agentsWorkflows ?? []), workflow]
    flushAgentsWorkflowDefinitions(this)
    return workflow
  }

  updateAgentsWorkflow(
    id: string,
    expectedRevision: number,
    updates: AgentsWorkflowUpdateFields
  ): AgentsWorkflowDefinition {
    const current = this.showAgentsWorkflow(id)
    assertRevision(current, expectedRevision)
    const definedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    )
    const updated: AgentsWorkflowDefinition = {
      ...current,
      ...definedUpdates,
      id: current.id,
      revision: current.revision + 1,
      creationKey: current.creationKey,
      schedulerOwner: 'local_host_service',
      createdAt: current.createdAt,
      updatedAt: Date.now()
    }
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    runtime.state.agentsWorkflows = (runtime.state.agentsWorkflows ?? []).map((entry) =>
      entry.id === id ? updated : entry
    )
    flushAgentsWorkflowDefinitions(this)
    return updated
  }

  deleteAgentsWorkflow(id: string, expectedRevision: number): boolean {
    const current = this.showAgentsWorkflow(id)
    assertRevision(current, expectedRevision)
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    runtime.state.agentsWorkflows = (runtime.state.agentsWorkflows ?? []).filter(
      (entry) => entry.id !== id
    )
    flushAgentsWorkflowDefinitions(this)
    return true
  }

  listAgentsWorkflowRuns(input: {
    workflowId?: string
    cursor?: string
    limit: number
  }): AgentsWorkflowRunsPage {
    const runs = [
      ...(this[agentsWorkflowPersistenceContext].runtime.state.agentsWorkflowRuns ?? [])
    ]
      .filter((run) => input.workflowId === undefined || run.workflowId === input.workflowId)
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
    const start = input.cursor
      ? Math.max(0, runs.findIndex((run) => run.id === input.cursor) + 1)
      : 0
    const page = runs.slice(start, start + input.limit)
    return {
      runs: page.map(toRunSummary),
      nextCursor: start + input.limit < runs.length ? (page.at(-1)?.id ?? null) : null
    }
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
    runInput: string
    requestKey: string
    now: number
    trigger?: 'manual' | 'schedule'
    scheduledFor?: number
  }): { run: AgentsWorkflowRun; created: boolean } {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const runs = runtime.state.agentsWorkflowRuns ?? []
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
        isActiveRun(run) &&
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
      input: input.runInput,
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
    const requestKey = `schedule:${input.scheduledFor}`
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
      input: input.workflow.trigger.defaultInput,
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
    const updated = { ...current, ...updates }
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
    return this.updateAgentsWorkflowRun(runId, {
      attempts: attempts.map((attempt) => ({ ...attempt })),
      executionTrace: [...executionTrace]
    })
  }

  markInterruptedAgentsWorkflowRunsUnverifiable(now: number): AgentsWorkflowRun[] {
    const runtime = this[agentsWorkflowPersistenceContext].runtime
    const interrupted = (runtime.state.agentsWorkflowRuns ?? []).filter(isActiveRun)
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

function isActiveRun(run: AgentsWorkflowRun): boolean {
  return run.status === 'pending' || run.status === 'running' || run.status === 'cancel_requested'
}

function pruneTerminalRuns(runtime: AgentsWorkflowPersistenceRuntime, workflowId: string): void {
  const runs = runtime.state.agentsWorkflowRuns ?? []
  const retainedTerminalIds = new Set(
    runs
      .filter((run) => run.workflowId === workflowId && isPrunableTerminalRun(run))
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, TERMINAL_RUN_RETENTION_PER_WORKFLOW)
      .map((run) => run.id)
  )
  runtime.state.agentsWorkflowRuns = runs.filter(
    (run) =>
      run.workflowId !== workflowId ||
      !isPrunableTerminalRun(run) ||
      retainedTerminalIds.has(run.id)
  )
}

function isPrunableTerminalRun(run: AgentsWorkflowRun): boolean {
  return (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'skipped'
  )
}

function toRunSummary(run: AgentsWorkflowRun): AgentsWorkflowRunSummary {
  const {
    definitionSnapshot: _definitionSnapshot,
    attempts: _attempts,
    executionTrace: _executionTrace,
    ...summary
  } = run
  return summary
}

function assertRevision(workflow: AgentsWorkflowDefinition, expectedRevision: number): void {
  if (workflow.revision !== expectedRevision) {
    throw new AgentsWorkflowRevisionConflictError(expectedRevision, workflow.revision)
  }
}
