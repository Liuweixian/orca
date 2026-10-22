import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import {
  agentsWorkflowOccurrencesDescending,
  latestAgentsWorkflowOccurrence
} from './agents-workflow-schedule-occurrence'

const DEFAULT_TICK_MS = 60_000
const MINUTE_MS = 60_000
/** How many missed occurrences one tick may record; the rest wait for the next tick. */
const MAX_MISSED_OCCURRENCES_PER_TICK = 50

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
      await this.recordMissedOccurrences(workflow, now)
      return
    }
    await this.dependencies.runScheduled(workflow, scheduledFor)
  }

  /**
   * Records every occurrence nobody claimed while the app was down.
   *
   * Why not just the latest: after a three-day outage only the newest occurrence was recorded, and
   * the run history showed an unexplained hole where the earlier ones should have been. Walking
   * back stops at the first occurrence that has a run — that is where the gap ends — and at the
   * workflow's own creation, so a long-lived schedule does not backfill rows it never owed.
   */
  private async recordMissedOccurrences(
    workflow: AgentsWorkflowDefinition,
    now: number
  ): Promise<void> {
    const schedule = workflow.trigger.schedule
    if (!schedule) {
      return
    }
    let recorded = 0
    for (const occurrence of agentsWorkflowOccurrencesDescending(schedule, now)) {
      if (occurrence < workflow.createdAt) {
        return
      }
      if (this.dependencies.hasScheduledRun(workflow.id, occurrence)) {
        return
      }
      await this.dependencies.recordSkipped(workflow, occurrence, 'missed_grace')
      recorded += 1
      if (recorded >= MAX_MISSED_OCCURRENCES_PER_TICK) {
        return
      }
    }
  }
}
