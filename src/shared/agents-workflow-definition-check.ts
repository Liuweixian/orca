// The checks a definition must pass before it is stored.
//
// The canvas already computes the same issues for display; this module is the copy the host runs
// before accepting a write, so an invalid graph cannot reach a scheduled run and fail silently
// every hour.

import {
  validateWorkflowDefinition,
  type AgentsWorkflowValidationIssue
} from './agents-workflow-graph'
import type { AgentsWorkflowSchedule } from './agents-workflow-types'
import { parseSchedule } from './automation-schedule-parsing'

export function agentsWorkflowScheduleIssues(
  schedule: AgentsWorkflowSchedule | null | undefined
): AgentsWorkflowValidationIssue[] {
  if (!schedule) {
    return []
  }
  const issues: AgentsWorkflowValidationIssue[] = []
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone })
  } catch {
    issues.push({
      severity: 'error',
      code: 'schedule_timezone_invalid',
      message: `Schedule timezone "${schedule.timezone}" is not a known IANA zone.`
    })
  }
  try {
    if (parseSchedule(schedule.rrule).kind !== 'rrule') {
      issues.push({
        severity: 'error',
        code: 'schedule_rrule_invalid',
        message: 'Agent workflow schedules require RRULE syntax.'
      })
    }
  } catch {
    issues.push({
      severity: 'error',
      code: 'schedule_rrule_invalid',
      message: `Schedule recurrence "${schedule.rrule}" cannot be parsed.`
    })
  }
  return issues
}

/** Every error that must block a write; warnings stay advisory. */
export function agentsWorkflowDefinitionErrors(input: unknown): AgentsWorkflowValidationIssue[] {
  const issues = validateWorkflowDefinition(input)
  const schedule =
    typeof input === 'object' && input !== null
      ? ((input as { trigger?: { schedule?: AgentsWorkflowSchedule | null } }).trigger?.schedule ??
        null)
      : null
  issues.push(...agentsWorkflowScheduleIssues(schedule))
  return issues.filter((issue) => issue.severity === 'error')
}
