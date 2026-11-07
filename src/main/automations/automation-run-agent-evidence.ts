/** What an idle pane says about a run, judged as any agent turn sent at the run's dispatch. */
import {
  automationRunFailure,
  type AutomationRunFailure
} from '../../shared/automation-run-failure-copy'
import {
  isTurnDoneSince,
  judgeIdleAgentTurn,
  type AgentTurnStatusRow
} from '../runtime/agent-state-rules/agent-turn-idle-verdict'

export { AGENT_START_GRACE_MS } from '../runtime/agent-state-rules/agent-turn-idle-verdict'

export type AutomationRunAgentEvidence = {
  /** Agent status rows for a pane, from hooks, OSC and titles alike. */
  getAgentStatusRowsForPane(paneKey: string): readonly AgentTurnStatusRow[]
  /** The names the run's agent command may run under, to tell its refusal from its output. */
  agentCommandsForRun(run: RunCompletionSubject): readonly string[]
}

/**
 * The run facts a pane's completion verdict needs. An `AutomationRun` is one such subject; a
 * workflow turn has the same facts without being an automation run (and names no automation).
 */
export type RunCompletionSubject = {
  automationId?: string | null
  terminalPaneKey: string | null
  dispatchedAt?: number | null
  startedAt?: number | null
}

export type IdleRunVerdict =
  | { kind: 'completed' }
  | ({ kind: 'failed' } & AutomationRunFailure)
  /** An idle shell that may not have started the agent yet. */
  | { kind: 'wait' }

export function judgeIdleRun(
  evidence: AutomationRunAgentEvidence,
  run: RunCompletionSubject,
  tail: readonly string[],
  runStartedAt: number,
  now: number
): IdleRunVerdict {
  const verdict = judgeIdleAgentTurn(
    {
      rows: run.terminalPaneKey ? evidence.getAgentStatusRowsForPane(run.terminalPaneKey) : [],
      // Ignore completion evidence from before this run’s prompt.
      sentAt: run.dispatchedAt ?? runStartedAt,
      tail,
      readAgentCommands: () => evidence.agentCommandsForRun(run)
    },
    now
  )
  if (verdict.kind === 'failed') {
    return {
      kind: 'failed',
      error: `Automation agent did not start; this host could not run its command (${verdict.missingCommandLine}).`
    }
  }
  if (verdict.kind === 'completed' && verdict.interrupted) {
    return { kind: 'failed', ...automationRunFailure('agentInterrupted') }
  }
  return verdict.kind === 'completed' ? { kind: 'completed' } : verdict
}

/** The run's verdict once the agent reported its turn done at least `heldForMs` ago and no row of its pane says otherwise; null until then. Decided from one read of the rows, so a row cleared afterwards cannot change it. */
export function judgeHeldRunTurn(
  evidence: AutomationRunAgentEvidence,
  run: RunCompletionSubject,
  runStartedAt: number,
  now: number,
  heldForMs: number
): Exclude<IdleRunVerdict, { kind: 'wait' }> | null {
  const sentAt = run.dispatchedAt ?? runStartedAt
  const rows = (
    run.terminalPaneKey ? evidence.getAgentStatusRowsForPane(run.terminalPaneKey) : []
  ).filter((row) => !row.providerSessionOnly)
  const done = rows.filter((row) => isTurnDoneSince(row, sentAt))
  if (
    !rows.every((row) => row.state === 'done') ||
    !done.some((row) => now - row.stateStartedAt >= heldForMs)
  ) {
    return null
  }
  return done.some((row) => row.interrupted === true)
    ? { kind: 'failed', ...automationRunFailure('agentInterrupted') }
    : { kind: 'completed' }
}
