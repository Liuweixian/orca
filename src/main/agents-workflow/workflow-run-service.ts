import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../shared/agents-workflow-run-types'
import { AgentsWorkflowRunConflictError } from '../../shared/agents-workflow-errors'
import {
  createProductionAgentsWorkflowExecutionAdapter,
  type AgentsWorkflowExecutionAdapter
} from './workflow-agent-execution-adapter'
import { executeAgentsWorkflowSchedule } from './workflow-dynamic-scheduler'

export type AgentsWorkflowRunPersistence = {
  showAgentsWorkflow(id: string): AgentsWorkflowDefinition
  createAgentsWorkflowRun(input: {
    workflow: AgentsWorkflowDefinition
    runInput: string
    requestKey: string
    now: number
    trigger?: 'manual' | 'schedule'
    scheduledFor?: number
  }): { run: AgentsWorkflowRun; created: boolean }
  createSkippedAgentsWorkflowOccurrence(input: {
    workflow: AgentsWorkflowDefinition
    scheduledFor: number
    now: number
    reason: 'active_run' | 'missed_grace'
  }): AgentsWorkflowRun
  updateAgentsWorkflowRun(runId: string, updates: Partial<AgentsWorkflowRun>): AgentsWorkflowRun
  replaceAgentsWorkflowRunTrace(
    runId: string,
    attempts: readonly AgentsWorkflowRun['attempts'][number][],
    executionTrace: readonly string[]
  ): AgentsWorkflowRun
  showAgentsWorkflowRun(runId: string): AgentsWorkflowRun
  listAgentsWorkflowRuns(input: {
    workflowId?: string
    cursor?: string
    limit: number
  }): AgentsWorkflowRunsPage
  markInterruptedAgentsWorkflowRunsUnverifiable(now: number): AgentsWorkflowRun[]
  flushPendingOrThrowAsync?: (options?: { drainToStableGeneration?: boolean }) => Promise<void>
}

export type AgentsWorkflowWorkspaceResolver = (
  workflow: AgentsWorkflowDefinition,
  runId: string
) => Promise<
  | { ok: true; workspaceId: string; displayName: string }
  | { ok: false; code: string; message: string }
>

export class AgentsWorkflowRunService {
  private readonly abortByRunId = new Map<string, AbortController>()
  private recovered = false

  constructor(
    private readonly persistence: AgentsWorkflowRunPersistence,
    private readonly notifyChanged: () => void,
    private readonly adapter: AgentsWorkflowExecutionAdapter = createProductionAgentsWorkflowExecutionAdapter(),
    private readonly resolveWorkspace: AgentsWorkflowWorkspaceResolver = failClosedWorkspaceResolver,
    private readonly now: () => number = Date.now
  ) {}

  async runNow(input: {
    workflowId: string
    input: string
    requestKey: string
  }): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    const workflow = this.persistence.showAgentsWorkflow(input.workflowId)
    const created = this.persistence.createAgentsWorkflowRun({
      workflow,
      runInput: input.input,
      requestKey: input.requestKey,
      now: this.now()
    })
    if (!created.created) {
      return created.run
    }
    await this.flush()
    this.notifyChanged()
    void this.execute(created.run).catch((error: unknown) => {
      console.error('[agents-workflow] Run execution failed:', error)
    })
    return created.run
  }

  async runScheduled(
    workflow: AgentsWorkflowDefinition,
    scheduledFor: number
  ): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    let created: { run: AgentsWorkflowRun; created: boolean }
    try {
      created = this.persistence.createAgentsWorkflowRun({
        workflow,
        runInput: workflow.trigger.defaultInput,
        requestKey: `schedule:${scheduledFor}`,
        now: this.now(),
        trigger: 'schedule',
        scheduledFor
      })
    } catch (error) {
      if (!(error instanceof AgentsWorkflowRunConflictError)) {
        throw error
      }
      return await this.recordSkippedOccurrence(workflow, scheduledFor, 'active_run')
    }
    if (!created.created) {
      return created.run
    }
    await this.flush()
    this.notifyChanged()
    void this.execute(created.run).catch((error: unknown) => {
      console.error('[agents-workflow] Scheduled run execution failed:', error)
    })
    return created.run
  }

  async recordSkippedOccurrence(
    workflow: AgentsWorkflowDefinition,
    scheduledFor: number,
    reason: 'active_run' | 'missed_grace'
  ): Promise<AgentsWorkflowRun> {
    const run = this.persistence.createSkippedAgentsWorkflowOccurrence({
      workflow,
      scheduledFor,
      now: this.now(),
      reason
    })
    await this.flush()
    this.notifyChanged()
    return run
  }

  async cancelRun(runId: string): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    const run = this.persistence.showAgentsWorkflowRun(runId)
    if (!isActive(run)) {
      return run
    }
    this.persistence.updateAgentsWorkflowRun(runId, { status: 'cancel_requested' })
    await this.flush()
    this.notifyChanged()
    this.abortByRunId.get(runId)?.abort()
    const stopped = await this.adapter.cancel(runId)
    const status = stopped === 'stopped' ? 'cancelled' : 'unverifiable'
    const finishedAt = this.now()
    const updated = this.persistence.updateAgentsWorkflowRun(runId, {
      status,
      finishedAt,
      attempts: run.attempts.map((attempt) =>
        attempt.status === 'running' || attempt.status === 'pending'
          ? { ...attempt, status, finishedAt }
          : attempt
      ),
      ...(status === 'unverifiable'
        ? {
            errorCode: 'cancellation_unverifiable',
            errorMessage: 'The agent stop request could not be confirmed.'
          }
        : {})
    })
    await this.flush()
    this.notifyChanged()
    return updated
  }

  async runs(input: {
    workflowId?: string
    cursor?: string
    limit: number
  }): Promise<AgentsWorkflowRunsPage> {
    await this.recoverInterrupted()
    return this.persistence.listAgentsWorkflowRuns(input)
  }

  async showRun(runId: string): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    return this.persistence.showAgentsWorkflowRun(runId)
  }

  private async execute(initial: AgentsWorkflowRun): Promise<void> {
    const controller = new AbortController()
    this.abortByRunId.set(initial.id, controller)
    const workspace = await this.resolveWorkspace(initial.definitionSnapshot, initial.id)
    if (!workspace.ok) {
      this.abortByRunId.delete(initial.id)
      await this.finish(initial.id, 'failed', workspace.code, workspace.message)
      return
    }
    if (!isActive(this.persistence.showAgentsWorkflowRun(initial.id))) {
      this.abortByRunId.delete(initial.id)
      return
    }
    this.persistence.updateAgentsWorkflowRun(initial.id, {
      status: 'running',
      startedAt: this.now(),
      workspaceId: workspace.workspaceId,
      workspaceDisplayName: workspace.displayName
    })
    await this.flush()
    this.notifyChanged()
    const result = await executeAgentsWorkflowSchedule({
      definition: initial.definitionSnapshot,
      runInput: initial.input,
      executeAgent: this.adapter.execute,
      signal: controller.signal,
      now: this.now,
      executionContext: { runId: initial.id, workspaceId: workspace.workspaceId },
      checkpoint: async ({ attempts, executionTrace }) => {
        this.persistence.replaceAgentsWorkflowRunTrace(initial.id, attempts, executionTrace)
        await this.flush()
        this.notifyChanged()
      }
    })
    this.abortByRunId.delete(initial.id)
    if (!isActive(this.persistence.showAgentsWorkflowRun(initial.id))) {
      return
    }
    if (result.ok) {
      await this.finish(initial.id, 'completed')
      return
    }
    const status = result.unverifiable ? 'unverifiable' : result.cancelled ? 'cancelled' : 'failed'
    await this.finish(initial.id, status, result.code, result.message)
  }

  private async finish(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'unverifiable',
    errorCode?: string,
    errorMessage?: string
  ): Promise<void> {
    this.persistence.updateAgentsWorkflowRun(runId, {
      status,
      finishedAt: this.now(),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorMessage === undefined ? {} : { errorMessage })
    })
    await this.flush()
    this.notifyChanged()
  }

  private async recoverInterrupted(): Promise<void> {
    if (this.recovered) {
      return
    }
    this.recovered = true
    const recovered = this.persistence.markInterruptedAgentsWorkflowRunsUnverifiable(this.now())
    if (recovered.length > 0) {
      await this.flush()
      this.notifyChanged()
    }
  }

  private async flush(): Promise<void> {
    await this.persistence.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
  }
}

function isActive(run: AgentsWorkflowRun): boolean {
  return run.status === 'pending' || run.status === 'running' || run.status === 'cancel_requested'
}

const failClosedWorkspaceResolver: AgentsWorkflowWorkspaceResolver = async () => {
  return {
    ok: false,
    code: 'workflow_workspace_adapter_unavailable',
    message: 'The workflow workspace launch adapter is unavailable on this build.'
  }
}
