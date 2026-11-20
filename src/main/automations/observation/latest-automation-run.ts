import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { Store } from '../../persistence/loading-store/store'
import type { RunCompletionSubject } from './automation-run-agent-evidence'

/** Why: the observer accepts any run subject, but only an automation run owns a launch receipt and the pane and history this cleanup compares; workflow turns name no automation. */
export function findLatestAutomationRun(
  store: Store,
  subject: RunCompletionSubject | undefined
): AutomationRun | undefined {
  if (!subject?.automationId) {
    return undefined
  }
  return (
    store
      .listAutomationRuns(subject.automationId)
      .find((entry) => entry.terminalPaneKey === subject.terminalPaneKey) ??
    // Why: a subject that still carries run identity names its run even before the run is stored.
    asAutomationRun(subject)
  )
}

function asAutomationRun(subject: RunCompletionSubject | undefined): AutomationRun | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the automation run that produced the subject carries these fields.
  return subject && 'id' in subject && 'sessionKind' in subject
    ? (subject as AutomationRun)
    : undefined
}
