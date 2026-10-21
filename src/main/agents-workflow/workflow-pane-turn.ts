// One agent turn on a real pane: launch it, wait for it to settle, close it when asked.
//
// The pane channels differ only in what they read afterwards — the file contract, or the agent's
// own transcript — so the lifecycle they share lives here once.

import type { TuiAgent } from '../../shared/tui-agent'
import {
  agentsWorkflowAgentSettlement,
  type AgentsWorkflowTurnSettlement
} from '../../shared/agents-workflow-agent-channels'
import { getTuiAgentDetectCommands, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'
import type { AutomationRunAgentEvidence } from '../automations/automation-run-agent-evidence'

export type WorkflowPaneTurnRuntime = Pick<
  OrcaRuntimeService,
  | 'launchAgentTerminal'
  | 'closeTerminal'
  | 'getTerminalHandleForPaneKey'
  | 'waitForTerminal'
  | 'readTerminal'
  | 'getAgentStatusRowsForPane'
>

export type WorkflowPaneTurnRefusal = {
  ok: false
  code: string
  message: string
  unverifiable?: boolean
}

export type WorkflowPaneLaunch = {
  runId: string
  nodeId: string
  workspaceId: string
  agent: TuiAgent
  prompt: string
  title?: string
  extraAgentArgs?: string
}

export function paneTurnRefusal(
  code: string,
  message: string,
  unverifiable = false
): WorkflowPaneTurnRefusal {
  return { ok: false, code, message, ...(unverifiable ? { unverifiable: true } : {}) }
}

/** Enough scrollback to show what a report node said. */
const PANE_TAIL_LIMIT = 2_000

/** A launched turn, with the facts its completion verdict is judged on. */
export type WorkflowPaneTurn = {
  handle: string
  paneKey: string | null
  agent: TuiAgent
  /** When the prompt was handed to this pane; an earlier turn's `done` does not count. */
  dispatchedAt: number
}

export class WorkflowPaneTurns {
  private readonly panesByRunId = new Map<string, Map<string, WorkflowPaneTurn>>()

  constructor(private readonly runtime: WorkflowPaneTurnRuntime) {}

  async launch(
    launch: WorkflowPaneLaunch
  ): Promise<({ ok: true } & WorkflowPaneTurn) | WorkflowPaneTurnRefusal> {
    let launched: Awaited<ReturnType<WorkflowPaneTurnRuntime['launchAgentTerminal']>>
    try {
      launched = await this.runtime.launchAgentTerminal(`id:${launch.workspaceId}`, {
        agent: launch.agent,
        prompt: launch.prompt,
        ...(launch.title ? { title: launch.title } : {}),
        ...(launch.extraAgentArgs ? { extraAgentArgs: launch.extraAgentArgs } : {})
      })
    } catch (error) {
      return paneTurnRefusal(
        'terminal_agent_launch_failed',
        error instanceof Error ? error.message : String(error),
        true
      )
    }
    const panes = this.panesByRunId.get(launch.runId) ?? new Map<string, WorkflowPaneTurn>()
    const previous = panes.get(launch.nodeId)
    if (previous && previous.handle !== launched.handle) {
      // A retried node must not leave its earlier pane open and untracked.
      try {
        await this.runtime.closeTerminal(previous.handle)
      } catch {
        // The old pane is already gone, which is what closing it would achieve.
      }
    }
    const turn: WorkflowPaneTurn = {
      handle: launched.handle,
      paneKey: launched.paneKey ?? null,
      agent: launch.agent,
      dispatchedAt: Date.now()
    }
    panes.set(launch.nodeId, turn)
    this.panesByRunId.set(launch.runId, panes)
    return { ok: true, ...turn }
  }

  /** The pane's recent text, for a report node's run-history evidence. */
  async readTail(handle: string): Promise<string[]> {
    try {
      return (await this.runtime.readTerminal(handle, { limit: PANE_TAIL_LIMIT })).tail
    } catch {
      return []
    }
  }

  /**
   * Waits for this turn's agent to report that it finished.
   *
   * Why the agent's own status rows and not the pane's idle edge: a fresh TUI paints its composer
   * and reads idle a couple of seconds after the prompt goes in, so an idle pane says nothing
   * about whether the turn is over. Trusting it failed a three-minute review node 12s after launch
   * with output_contract_missing. Only a `done` row that started after this turn was dispatched
   * completes it; a pane whose agent never reports status still falls back to a sustained idle
   * window, exactly as automation runs are judged.
   */
  async settle(
    turn: WorkflowPaneTurn,
    signal?: AbortSignal
  ): Promise<{ ok: true; settlement: AgentsWorkflowTurnSettlement } | WorkflowPaneTurnRefusal> {
    const evidence = this.completionEvidence(turn)
    try {
      const observation = await createRuntimeAutomationRunTerminalObserver(
        this.runtime,
        evidence
      ).observeCompletion(turn.handle, {
        signal: signal ?? new AbortController().signal,
        ...(evidence && turn.paneKey
          ? {
              run: {
                terminalPaneKey: turn.paneKey,
                dispatchedAt: turn.dispatchedAt,
                startedAt: turn.dispatchedAt
              }
            }
          : {})
      })
      if (signal?.aborted) {
        return paneTurnRefusal('cancelled', 'Workflow run was cancelled.')
      }
      if (observation.status !== 'completed') {
        return paneTurnRefusal(
          'terminal_agent_did_not_complete',
          observation.error ?? 'The terminal agent did not report completion.',
          true
        )
      }
      return {
        ok: true,
        // Why report it: a weak settlement (no hooks, no title) is an idle guess, so a channel
        // that waits on an artifact must not treat it as a final "turn is over" edge.
        settlement: agentsWorkflowAgentSettlement(turn.agent)
      }
    } catch (error) {
      // Why: a pane closed, reloaded, or lost its handle ends the wait without proving anything
      // about the agent. Report that as unverifiable instead of throwing: a throw used to escape
      // the scheduler and fail the whole run with `workflow_execution_failed`, leaving the node's
      // attempt stuck at `running`.
      return paneTurnRefusal(
        'terminal_agent_unverifiable',
        `The workflow pane stopped reporting before the agent finished: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true
      )
    }
  }

  /** The evidence a turn is judged by, or undefined when the host could not name its pane. */
  private completionEvidence(turn: WorkflowPaneTurn): AutomationRunAgentEvidence | undefined {
    if (!turn.paneKey) {
      return undefined
    }
    const config = TUI_AGENT_CONFIG[turn.agent]
    const commands = [...getTuiAgentDetectCommands(config), config.launchCmd]
    return {
      getAgentStatusRowsForPane: (paneKey) => this.runtime.getAgentStatusRowsForPane(paneKey),
      // Why empty on the subject: the commands belong to the node's agent, not to the run.
      agentCommandsForRun: () => commands
    }
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    const panes = this.panesByRunId.get(runId)
    if (!panes || panes.size === 0) {
      return 'unverifiable'
    }
    this.panesByRunId.delete(runId)
    let stopped = true
    for (const pane of panes.values()) {
      try {
        const closed = await this.runtime.closeTerminal(pane.handle)
        stopped = stopped && closed.ptyKilled
      } catch {
        stopped = false
      }
    }
    return stopped ? 'stopped' : 'unverifiable'
  }

  async release(runId: string, options: { reclaim: boolean }): Promise<void> {
    const panes = this.panesByRunId.get(runId)
    this.panesByRunId.delete(runId)
    if (!options.reclaim || !panes) {
      return
    }
    for (const pane of panes.values()) {
      try {
        await this.runtime.closeTerminal(pane.handle)
      } catch {
        // A closed pane is the goal; an already-gone one reached it.
      }
    }
  }
}
