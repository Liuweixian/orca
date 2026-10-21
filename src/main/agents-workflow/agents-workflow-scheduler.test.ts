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
    trigger: { manual: true, defaultInput: 'scheduled input', schedule },
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
})
