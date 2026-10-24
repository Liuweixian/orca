/** What an idle pane says about a run, judged as any agent turn sent at the run's dispatch. */
import { judgeIdleAgentTurn, type AgentTurnStatusRow } from '../agent-turn-idle-verdict'

export { AGENT_START_GRACE_MS } from '../agent-turn-idle-verdict'

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
  | { kind: 'failed'; error: string }
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
  return verdict.kind === 'failed'
    ? {
        kind: 'failed',
        error: `Automation agent did not start; this host could not run its command (${verdict.missingCommandLine}).`
      }
    : verdict
}
