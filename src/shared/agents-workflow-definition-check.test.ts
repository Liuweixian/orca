import { describe, expect, it } from 'vitest'
import { agentsWorkflowScheduleIssues } from './agents-workflow-definition-check'

const base = { timezone: 'UTC', dtstart: 1, missedRunGraceMinutes: 60 }

describe('agentsWorkflowScheduleIssues', () => {
  it('accepts a rule it can fully honor', () => {
    expect(
      agentsWorkflowScheduleIssues({
        ...base,
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0'
      })
    ).toEqual([])
  })

  it('rejects RRULE parts workflows would otherwise ignore', () => {
    // Why: treating INTERVAL=2 as plain weekly would run the workflow twice as often as asked.
    const issues = agentsWorkflowScheduleIssues({
      ...base,
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0'
    })
    expect(issues.map((issue) => issue.code)).toContain('schedule_rrule_unsupported')
    expect(issues.map((issue) => issue.message).join(' ')).toContain('INTERVAL')
  })

  it('rejects unknown timezones and cron syntax', () => {
    const codes = agentsWorkflowScheduleIssues({
      ...base,
      timezone: 'Mars/Olympus',
      rrule: '0 9 * * *'
    }).map((issue) => issue.code)
    expect(codes).toContain('schedule_timezone_invalid')
    expect(codes).toContain('schedule_rrule_invalid')
  })
})
