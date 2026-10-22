import { agentsWorkflowDefinitionErrors } from '../../shared/agents-workflow-definition-check'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import {
  agentsWorkflowOccurrencesDescending,
  latestAgentsWorkflowOccurrence
} from './agents-workflow-schedule-occurrence'

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
  /**
   * Definitions already reported as unrunnable. Why keyed by id and revision: the store accepts an
   * invalid graph as a draft, so a scheduled run of one used to fail on every occurrence with no
   * explanation. The log line is a diagnostic, not a per-tick promise, and editing the workflow
   * must be able to report it again.
   */
  private readonly invalidDefinitionsReported = new Set<string>()

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
    if (!this.definitionIsRunnable(workflow)) {
      return
    }
    const scheduledFor = latestAgentsWorkflowOccurrence(schedule, now)
    if (scheduledFor === null) {
      return
    }
    if (this.dependencies.hasScheduledRun(workflow.id, scheduledFor)) {
      // Why still walk back: the newest occurrence is recorded, but a capped backfill may have
      // left older holes that no later tick would ever revisit.
      await this.recordMissedOccurrence(workflow, now)
      return
    }
    if (now - scheduledFor > schedule.missedRunGraceMinutes * MINUTE_MS) {
      await this.recordMissedOccurrence(workflow, now)
      return
    }
    await this.dependencies.runScheduled(workflow, scheduledFor)
  }

  /**
   * Why the check here and not only in the editor: a definition stored before `run_context_not_local`
   * (or any other run-blocking error) was accepted kept failing unattended. Skipping it leaves the
   * canvas, which shows the same errors, as the place to fix it.
   */
  private definitionIsRunnable(workflow: AgentsWorkflowDefinition): boolean {
    const errors = agentsWorkflowDefinitionErrors(workflow)
    if (errors.length === 0) {
      this.invalidDefinitionsReported.delete(workflow.id)
      return true
    }
    const key = `${workflow.id}:${workflow.revision}`
    if (!this.invalidDefinitionsReported.has(key)) {
      this.invalidDefinitionsReported.add(key)
      console.warn(
        `[agents-workflow] Skipping scheduled runs of "${workflow.name}": ${errors
          .map((issue) => issue.message)
          .join('; ')}`
      )
    }
    return false
  }

  /**
   * Records the newest occurrence nobody claimed.
   *
   * Why one per tick: walking back to `createdAt` every time a schedule was enabled turned a
   * month-old draft into dozens of `skipped` rows in one pass, each flushed and broadcast, which
   * pushed real failures out of the retained history. A later tick revisits the remaining holes,
   * so the backfill still completes without a burst.
   */
  private async recordMissedOccurrence(
    workflow: AgentsWorkflowDefinition,
    now: number
  ): Promise<void> {
    const schedule = workflow.trigger.schedule
    if (!schedule) {
      return
    }
    for (const occurrence of agentsWorkflowOccurrencesDescending(schedule, now)) {
      if (occurrence < workflow.createdAt) {
        return
      }
      if (this.dependencies.hasScheduledRun(workflow.id, occurrence)) {
        continue
      }
      await this.dependencies.recordSkipped(workflow, occurrence, 'missed_grace')
      return
    }
  }
}
