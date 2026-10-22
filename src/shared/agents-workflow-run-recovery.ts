// The one rule for a run the app left active across a restart.
//
// Loading the persisted state and the first runtime recovery both meet the same rows. Keeping the
// transition here is what stops the two from drifting: a run marked one way on load must not be
// judged a second, different way moments later.

import type { AgentsWorkflowRun } from './agents-workflow-run-types'

export const AGENTS_WORKFLOW_RECOVERY_ERROR_CODE = 'execution_evidence_lost'
export const AGENTS_WORKFLOW_RECOVERY_ERROR_MESSAGE =
  'The app restarted without reliable process-exit evidence.'

/** The run as it ends when no process can prove how it stopped. */
export function markAgentsWorkflowRunInterrupted(
  run: AgentsWorkflowRun,
  now: number
): AgentsWorkflowRun {
  return {
    ...run,
    status: 'unverifiable',
    finishedAt: now,
    errorCode: AGENTS_WORKFLOW_RECOVERY_ERROR_CODE,
    errorMessage: AGENTS_WORKFLOW_RECOVERY_ERROR_MESSAGE,
    // Why persisted: load already marks the run, so a later recovery cannot tell from status alone
    // that the scratch folder is still there.
    scratchCleanupPending: true,
    attempts: run.attempts.map((attempt) =>
      attempt.status === 'running' || attempt.status === 'pending'
        ? { ...attempt, status: 'unverifiable', finishedAt: now }
        : attempt
    )
  }
}
