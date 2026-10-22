import { describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import { latestAgentsWorkflowOccurrence } from './agents-workflow-schedule-occurrence'
import { AgentsWorkflowScheduler } from './agents-workflow-scheduler'

function workflow(
  schedule: AgentsWorkflowDefinition['trigger']['schedule']
): AgentsWorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'workflow-1',
    revision: 1,
    name: 'Scheduled workflow',
    nodes: [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }],
    edges: [],
    runContext: {
      kind: 'workspace-run',
      projectId: 'project-1',
      hostId: 'local',
      projectHostSetupId: 'setup-1',
      repoId: 'repo-1',
      path: '/repo'
    },
    workspace: { mode: 'existing', workspaceId: 'folder-workspace-1' },
    trigger: { manual: true, schedule },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('AgentsWorkflowScheduler', () => {
  it('computes RRULE occurrences in the configured timezone', () => {
    const now = Date.UTC(2026, 0, 5, 14, 30)
    expect(
      latestAgentsWorkflowOccurrence(
        {
          timezone: 'America/New_York',
          rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
          dtstart: Date.UTC(2026, 0, 1),
          missedRunGraceMinutes: 60
        },
        now
      )
    ).toBe(now)
  })

  it('honors BYHOUR on an hourly rule instead of firing every hour', () => {
    // Why: the hourly branch used to skip the hour check, so a rule that named 9am fired at every
    // hour of the day.
    expect(
      latestAgentsWorkflowOccurrence(
        {
          timezone: 'UTC',
          rrule: 'FREQ=HOURLY;BYHOUR=9;BYMINUTE=15',
          dtstart: Date.UTC(2026, 0, 1),
          missedRunGraceMinutes: 60
        },
        Date.UTC(2026, 0, 5, 14, 30)
      )
    ).toBe(Date.UTC(2026, 0, 5, 9, 15))
  })

  it('runs an hourly rule that names no hour every hour', () => {
    expect(
      latestAgentsWorkflowOccurrence(
        {
          timezone: 'UTC',
          rrule: 'FREQ=HOURLY;BYMINUTE=0',
          dtstart: Date.UTC(2026, 0, 1),
          missedRunGraceMinutes: 60
        },
        Date.UTC(2026, 0, 5, 14, 30)
      )
    ).toBe(Date.UTC(2026, 0, 5, 14, 0))
  })

  it('never returns an occurrence before dtstart', () => {
    expect(
      latestAgentsWorkflowOccurrence(
        {
          timezone: 'UTC',
          rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
          dtstart: Date.UTC(2026, 0, 5, 10),
          missedRunGraceMinutes: 60
        },
        Date.UTC(2026, 0, 5, 11)
      )
    ).toBeNull()
  })

  it('starts one due occurrence and does not repeat its persisted occurrence', async () => {
    const now = Date.UTC(2026, 0, 5, 9)
    const definition = workflow({
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: Date.UTC(2026, 0, 1),
      missedRunGraceMinutes: 60
    })
    const runScheduled = vi.fn(async () => undefined)
    const scheduler = new AgentsWorkflowScheduler(
      {
        listWorkflows: () => [definition],
        hasScheduledRun: () => false,
        runScheduled,
        recordSkipped: vi.fn(async () => undefined)
      },
      60_000,
      () => now
    )

    await scheduler.evaluateDueRuns()
    expect(runScheduled).toHaveBeenCalledWith(definition, now)
  })

  it('does not start an occurrence that already claimed a run', async () => {
    const now = Date.UTC(2026, 0, 5, 9)
    const definition = workflow({
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: Date.UTC(2026, 0, 1),
      missedRunGraceMinutes: 60
    })
    const runScheduled = vi.fn(async () => undefined)
    const hasScheduledRun = vi.fn(() => true)
    const scheduler = new AgentsWorkflowScheduler(
      {
        listWorkflows: () => [definition],
        hasScheduledRun,
        runScheduled,
        recordSkipped: vi.fn(async () => undefined)
      },
      60_000,
      () => now
    )

    await scheduler.evaluateDueRuns()

    // Why the exact lookup: the run may already be outside the retained page, and a list scan
    // would then start the same occurrence twice.
    expect(hasScheduledRun).toHaveBeenCalledWith('workflow-1', now)
    expect(runScheduled).not.toHaveBeenCalled()
  })

  it('persists an occurrence skipped beyond grace', async () => {
    const scheduledFor = Date.UTC(2026, 0, 5, 9)
    const now = scheduledFor + 61 * 60_000
    const definition = workflow({
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: Date.UTC(2026, 0, 1),
      missedRunGraceMinutes: 60
    })
    const recordSkipped = vi.fn(async () => undefined)
    const scheduler = new AgentsWorkflowScheduler(
      {
        listWorkflows: () => [definition],
        hasScheduledRun: () => false,
        runScheduled: vi.fn(async () => undefined),
        recordSkipped
      },
      60_000,
      () => now
    )

    await scheduler.evaluateDueRuns()
    expect(recordSkipped).toHaveBeenCalledWith(definition, scheduledFor, 'missed_grace')
  })

  it('rolls a scheduling slot inside the spring-forward gap to the next real minute', () => {
    // 2026-03-08 02:30 does not exist in New York; dropping it erased a whole day of the rule.
    expect(
      latestAgentsWorkflowOccurrence(
        {
          timezone: 'America/New_York',
          rrule: 'FREQ=DAILY;BYHOUR=2;BYMINUTE=30',
          dtstart: Date.UTC(2026, 0, 1),
          missedRunGraceMinutes: 60
        },
        // 04:00 local (EDT) that day.
        Date.UTC(2026, 2, 8, 8)
      )
    ).toBe(Date.UTC(2026, 2, 8, 7))
  })

  it('keeps backfilling older holes after the newest occurrence already has a run', async () => {
    const definition = {
      ...workflow({
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: Date.UTC(2026, 0, 1),
        missedRunGraceMinutes: 60
      }),
      createdAt: Date.UTC(2026, 0, 5)
    }
    const now = Date.UTC(2026, 0, 8, 12)
    const latest = Date.UTC(2026, 0, 8, 9)
    const recordSkipped = vi.fn(async () => undefined)
    const scheduler = new AgentsWorkflowScheduler(
      {
        listWorkflows: () => [definition],
        // Only the newest occurrence was recorded before the cap stopped the earlier backfill.
        hasScheduledRun: (_workflowId, scheduledFor) => scheduledFor === latest,
        runScheduled: vi.fn(async () => undefined),
        recordSkipped
      },
      60_000,
      () => now
    )

    await scheduler.evaluateDueRuns()

    expect(
      recordSkipped.mock.calls.map((call) => (call as unknown as [unknown, number])[1])
    ).toEqual([Date.UTC(2026, 0, 7, 9), Date.UTC(2026, 0, 6, 9), Date.UTC(2026, 0, 5, 9)])
  })

  it('records every occurrence of an outage instead of only the newest one', async () => {
    const definition = {
      ...workflow({
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: Date.UTC(2026, 0, 1),
        missedRunGraceMinutes: 60
      }),
      createdAt: Date.UTC(2026, 0, 5)
    }
    const now = Date.UTC(2026, 0, 8, 12)
    const recordSkipped = vi.fn(async () => undefined)
    const scheduler = new AgentsWorkflowScheduler(
      {
        listWorkflows: () => [definition],
        hasScheduledRun: () => false,
        runScheduled: vi.fn(async () => undefined),
        recordSkipped
      },
      60_000,
      () => now
    )

    await scheduler.evaluateDueRuns()

    expect(
      recordSkipped.mock.calls.map((call) => (call as unknown as [unknown, number])[1])
    ).toEqual([
      Date.UTC(2026, 0, 8, 9),
      Date.UTC(2026, 0, 7, 9),
      Date.UTC(2026, 0, 6, 9),
      Date.UTC(2026, 0, 5, 9)
    ])
  })
})
