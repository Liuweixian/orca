import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../shared/agents-workflow-run-types'
import { agentsWorkflowScheduleRequestKey } from '../../shared/agents-workflow-run-types'
import { AgentsWorkflowRunConflictError } from '../../shared/agents-workflow-errors'
import {
  createProductionAgentsWorkflowExecutionAdapter,
  type AgentsWorkflowExecutionAdapter
} from './workflow-agent-execution-adapter'
import { executeAgentsWorkflowSchedule } from './workflow-dynamic-scheduler'
import {
  failClosedAgentsWorkflowWorkspaceResolver,
  finishAgentsWorkflowRun,
  flushAgentsWorkflowPersistence,
  isActiveAgentsWorkflowRun,
  recoverInterruptedAgentsWorkflowRuns,
  reclaimScheduledRunWorkspace,
  removeAgentsWorkflowRunScratch,
  type AgentsWorkflowRunLifecycle,
  type AgentsWorkflowRunWorkspaceReclaimer,
  type AgentsWorkflowWorkspacePathResolver,
  type RecoveryPersistence
} from './workflow-run-lifecycle'

export type AgentsWorkflowRunPersistence = {
  showAgentsWorkflow(id: string): AgentsWorkflowDefinition
  createAgentsWorkflowRun(input: {
    workflow: AgentsWorkflowDefinition
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
  | { ok: true; workspaceId: string; workspacePath: string; displayName: string }
  | { ok: false; code: string; message: string }
>

export class AgentsWorkflowRunService {
  private readonly abortByRunId = new Map<string, AbortController>()
  private recovered = false

  constructor(
    private readonly persistence: AgentsWorkflowRunPersistence,
    private readonly notifyChanged: () => void,
    private readonly adapter: AgentsWorkflowExecutionAdapter = createProductionAgentsWorkflowExecutionAdapter(),
    private readonly resolveWorkspace: AgentsWorkflowWorkspaceResolver = failClosedAgentsWorkflowWorkspaceResolver,
    private readonly now: () => number = Date.now,
    private readonly resolveWorkspacePath: AgentsWorkflowWorkspacePathResolver = async () => null,
    /**
     * Removes a worktree this run created. Only scheduled `new_per_run` runs reclaim it: nobody is
     * watching them, so leaving one per occurrence would grow the repo's workspace list forever.
     * A manual run keeps its checkout for the user.
     */
    private readonly reclaimCreatedWorkspace?: AgentsWorkflowRunWorkspaceReclaimer
  ) {}

  private get lifecycle(): AgentsWorkflowRunLifecycle & { persistence: RecoveryPersistence } {
    return {
      persistence: this.persistence,
      notifyChanged: this.notifyChanged,
      now: this.now,
      resolveWorkspacePath: this.resolveWorkspacePath
    }
  }

  async runNow(input: { workflowId: string; requestKey: string }): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    const workflow = this.persistence.showAgentsWorkflow(input.workflowId)
    const created = this.persistence.createAgentsWorkflowRun({
      workflow,
      requestKey: input.requestKey,
      now: this.now()
    })
    if (!created.created) {
      return created.run
    }
    await flushAgentsWorkflowPersistence(this.persistence)
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
        requestKey: agentsWorkflowScheduleRequestKey(scheduledFor),
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
    await flushAgentsWorkflowPersistence(this.persistence)
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
    await flushAgentsWorkflowPersistence(this.persistence)
    this.notifyChanged()
    return run
  }

  async cancelRun(runId: string): Promise<AgentsWorkflowRun> {
    await this.recoverInterrupted()
    const run = this.persistence.showAgentsWorkflowRun(runId)
    if (!isActiveAgentsWorkflowRun(run)) {
      return run
    }
    this.persistence.updateAgentsWorkflowRun(runId, { status: 'cancel_requested' })
    await flushAgentsWorkflowPersistence(this.persistence)
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
    await flushAgentsWorkflowPersistence(this.persistence)
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
    let workspacePath: string | null = null
    let workspaceId: string | null = null
    try {
      const workspace = await this.resolveWorkspace(initial.definitionSnapshot, initial.id)
      if (!workspace.ok) {
        await finishAgentsWorkflowRun(
          this.lifecycle,
          initial.id,
          'failed',
          workspace.code,
          workspace.message
        )
        return
      }
      workspacePath = workspace.workspacePath
      workspaceId = workspace.workspaceId
      if (!isActiveAgentsWorkflowRun(this.persistence.showAgentsWorkflowRun(initial.id))) {
        return
      }
      this.persistence.updateAgentsWorkflowRun(initial.id, {
        status: 'running',
        startedAt: this.now(),
        workspaceId: workspace.workspaceId,
        workspaceDisplayName: workspace.displayName
      })
      await flushAgentsWorkflowPersistence(this.persistence)
      this.notifyChanged()
      let result: Awaited<ReturnType<typeof executeAgentsWorkflowSchedule>>
      try {
        result = await executeAgentsWorkflowSchedule({
          definition: initial.definitionSnapshot,
          executeAgent: this.adapter.execute,
          signal: controller.signal,
          now: this.now,
          executionContext: {
            runId: initial.id,
            workspaceId: workspace.workspaceId,
            workspacePath: workspace.workspacePath
          },
          checkpoint: async ({ attempts, executionTrace }) => {
            this.persistence.replaceAgentsWorkflowRunTrace(initial.id, attempts, executionTrace)
            await flushAgentsWorkflowPersistence(this.persistence)
            this.notifyChanged()
          }
        })
      } catch (error) {
        // The scheduler threw instead of returning a failure: the run must not stay `running`.
        await finishAgentsWorkflowRun(
          this.lifecycle,
          initial.id,
          'failed',
          'workflow_execution_failed',
          error instanceof Error ? error.message : String(error)
        )
        return
      } finally {
        // Nobody watches a scheduled run, so it takes its chats and panes with it; a manual run
        // leaves them on screen for the user to follow.
        try {
          await this.adapter.release?.(initial.id, { reclaim: initial.trigger === 'schedule' })
        } catch (error) {
          // A reclaim failure must not mask the schedule's result.
          console.error('[agents-workflow] Run release failed:', error)
        }
      }
      if (!isActiveAgentsWorkflowRun(this.persistence.showAgentsWorkflowRun(initial.id))) {
        return
      }
      if (result.ok) {
        await finishAgentsWorkflowRun(this.lifecycle, initial.id, 'completed')
        return
      }
      // Why cancelled first: the user's intent is the outcome; unverifiable would blame the host.
      const status = result.cancelled
        ? 'cancelled'
        : result.unverifiable
          ? 'unverifiable'
          : 'failed'
      await finishAgentsWorkflowRun(this.lifecycle, initial.id, status, result.code, result.message)
    } catch (error) {
      // Resolving the workspace or persisting a checkpoint failed. Match the scheduler's guard:
      // an active run never stays running because bookkeeping threw.
      await finishAgentsWorkflowRun(
        this.lifecycle,
        initial.id,
        'failed',
        'workflow_execution_failed',
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      this.abortByRunId.delete(initial.id)
      if (workspacePath !== null) {
        await removeAgentsWorkflowRunScratch(workspacePath, initial.id)
      }
      await reclaimScheduledRunWorkspace(this.reclaimCreatedWorkspace, initial, workspaceId)
    }
  }

  private async recoverInterrupted(): Promise<void> {
    if (this.recovered) {
      return
    }
    this.recovered = true
    await recoverInterruptedAgentsWorkflowRuns(this.lifecycle)
  }
}
