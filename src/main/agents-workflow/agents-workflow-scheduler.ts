import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import { latestAgentsWorkflowOccurrence } from './agents-workflow-schedule-occurrence'

const DEFAULT_TICK_MS = 60_000
const MINUTE_MS = 60_000

export type AgentsWorkflowSchedulerDependencies = {
  listWorkflows: () => AgentsWorkflowDefinition[]
  /** Whether an occurrence already claimed its run. Exact lookup, never a bounded list scan. */
  hasScheduledRun: (workflowId: string, scheduledFor: number) => boolean
  runScheduled: (workflow: AgentsWorkflowDefinition, scheduledFor: number) => Promise<unknown>
  recordSkipped: (
    workflow: AgentsWorkflowDefinition,
    scheduledFor: number,
    reason: 'missed_grace'
  ) => Promise<unknown>
}

export class AgentsWorkflowScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private evaluating = false
  private stopped = false

  constructor(
    private readonly dependencies: AgentsWorkflowSchedulerDependencies,
    private readonly tickMs = DEFAULT_TICK_MS,
    private readonly now: () => number = Date.now
  ) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.stopped = false
    this.timer = setInterval(() => void this.evaluateDueRuns(), this.tickMs)
    void this.evaluateDueRuns()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async evaluateDueRuns(): Promise<void> {
    if (this.evaluating || this.stopped) {
      return
    }
    this.evaluating = true
    try {
      const now = this.now()
      for (const workflow of this.dependencies.listWorkflows()) {
        if (this.stopped || !workflow.enabled || workflow.trigger.schedule === null) {
          continue
        }
        try {
          await this.evaluateWorkflow(workflow, now)
        } catch (error) {
          console.error('[agents-workflow] Schedule evaluation failed:', error)
        }
      }
    } finally {
      this.evaluating = false
    }
  }

  private async evaluateWorkflow(workflow: AgentsWorkflowDefinition, now: number): Promise<void> {
    const schedule = workflow.trigger.schedule
    if (!schedule) {
      return
    }
    const scheduledFor = latestAgentsWorkflowOccurrence(schedule, now)
    if (scheduledFor === null || this.dependencies.hasScheduledRun(workflow.id, scheduledFor)) {
      return
    }
    if (now - scheduledFor > schedule.missedRunGraceMinutes * MINUTE_MS) {
      await this.dependencies.recordSkipped(workflow, scheduledFor, 'missed_grace')
      return
    }
    await this.dependencies.runScheduled(workflow, scheduledFor)
  }
}
