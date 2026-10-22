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
import { parseSchedule, unsupportedRruleParts } from './automation-schedule-parsing'

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
  // Why reject instead of ignore: honoring a rule as plain weekly when the author wrote
  // INTERVAL=2 would run it twice as often as asked.
  for (const part of unsupportedRruleParts(schedule.rrule)) {
    issues.push({
      severity: 'error',
      code: 'schedule_rrule_unsupported',
      message: `Schedule recurrence uses ${part}, which agent workflows do not support.`
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

/**
 * Every issue the definition has, warnings included. The canvas and the host both start here, so
 * "why is Run disabled" cannot drift between them.
 */
export function agentsWorkflowDefinitionIssues(input: unknown): AgentsWorkflowValidationIssue[] {
  return [...validateWorkflowDefinition(input), ...agentsWorkflowScheduleIssues(scheduleOf(input))]
}

/** Every error that must block a run; warnings stay advisory. */
export function agentsWorkflowDefinitionErrors(input: unknown): AgentsWorkflowValidationIssue[] {
  return agentsWorkflowDefinitionIssues(input).filter((issue) => issue.severity === 'error')
}

/**
 * The errors that block a *write*, which is a smaller set than what blocks a run. A graph the
 * author is still wiring must be storable as a draft, or closing the window loses it. So only a
 * definition the store cannot represent, and a schedule that would fail unattended on every
 * occurrence, are refused here; `agentsWorkflowDefinitionErrors` keeps blocking the Run button.
 */
export function agentsWorkflowDefinitionWriteErrors(
  input: unknown
): AgentsWorkflowValidationIssue[] {
  const issues = validateWorkflowDefinition(input).filter(
    (issue) => issue.severity === 'error' && issue.code === 'schema_invalid'
  )
  issues.push(
    ...agentsWorkflowScheduleIssues(scheduleOf(input)).filter((issue) => issue.severity === 'error')
  )
  return issues
}

function scheduleOf(input: unknown): AgentsWorkflowSchedule | null {
  return typeof input === 'object' && input !== null
    ? ((input as { trigger?: { schedule?: AgentsWorkflowSchedule | null } }).trigger?.schedule ??
        null)
    : null
}
