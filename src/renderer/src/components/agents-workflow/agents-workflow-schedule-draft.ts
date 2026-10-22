// The bridge between a workflow schedule and the automation schedule picker.
//
// The picker takes an `AutomationDraft`, whose other fields are meaningless here. Keeping the
// fabrication (and the reverse rrule assembly) in one small module keeps the definition panel about
// the workflow, and gives the next reader a single place to see what the reuse really needs.

import type { AgentsWorkflowSchedule } from '../../../../shared/agents-workflow-types'
import { buildAutomationRrule } from '../../../../shared/automation-schedule-occurrences'
import { tryParseAutomationRrule } from '../../../../shared/automation-schedule-parsing'
import type { AutomationDraft } from '../automations/AutomationEditorDialog'

const DEFAULT_HOUR = 9
const DEFAULT_MINUTE = 0

/** A draft carrying only the fields the picker reads, filled from the stored rrule. */
export function toScheduleDraft(schedule: AgentsWorkflowSchedule | null): AutomationDraft {
  const parsed = schedule ? tryParseAutomationRrule(schedule.rrule) : null
  const hour = parsed?.hour ?? DEFAULT_HOUR
  const minute = parsed?.minute ?? DEFAULT_MINUTE
  return {
    name: '',
    prompt: '',
    agentId: 'claude',
    extraAgentArgs: '',
    projectId: '',
    workspaceMode: 'new_per_run',
    workspaceId: '',
    baseBranch: '',
    reuseSession: false,
    precheckCommand: '',
    precheckTimeoutSeconds: '',
    preset: parsed?.preset === 'custom' ? 'daily' : (parsed?.preset ?? 'daily'),
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    dayOfWeek: String(parsed?.dayOfWeek ?? 1),
    customSchedule: '',
    savedSchedule: schedule?.rrule ?? null,
    missedRunGraceMinutes: String(schedule?.missedRunGraceMinutes ?? 60),
    scheduleWarning: null
  }
}

/** The rrule the picker's state stands for. Custom cron is not offered for workflows. */
export function rruleFromScheduleDraft(draft: AutomationDraft): string {
  const [hour, minute] = draft.time.split(':').map(Number)
  return buildAutomationRrule({
    preset: draft.preset === 'custom' ? 'daily' : draft.preset,
    hour: Number.isFinite(hour) ? hour : DEFAULT_HOUR,
    minute: Number.isFinite(minute) ? minute : DEFAULT_MINUTE,
    dayOfWeek: Number(draft.dayOfWeek)
  })
}
