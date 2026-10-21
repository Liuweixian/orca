// One agent turn on a real pane: launch it, wait for it to settle, close it when asked.
//
// The pane channels differ only in what they read afterwards — the file contract, or the agent's
// own transcript — so the lifecycle they share lives here once.

import type { TuiAgent } from '../../shared/tui-agent'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'

export type WorkflowPaneTurnRuntime = Pick<
  OrcaRuntimeService,
  | 'launchAgentTerminal'
  | 'closeTerminal'
  | 'getTerminalHandleForPaneKey'
  | 'waitForTerminal'
  | 'readTerminal'
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

type ActivePane = { handle: string }

export class WorkflowPaneTurns {
  private readonly panesByRunId = new Map<string, Map<string, ActivePane>>()

  constructor(private readonly runtime: WorkflowPaneTurnRuntime) {}

  async launch(
    launch: WorkflowPaneLaunch
  ): Promise<{ ok: true; handle: string } | WorkflowPaneTurnRefusal> {
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
    const panes = this.panesByRunId.get(launch.runId) ?? new Map<string, ActivePane>()
    const previous = panes.get(launch.nodeId)
    if (previous && previous.handle !== launched.handle) {
      // A retried node must not leave its earlier pane open and untracked.
      try {
        await this.runtime.closeTerminal(previous.handle)
      } catch {
        // The old pane is already gone, which is what closing it would achieve.
      }
    }
    panes.set(launch.nodeId, { handle: launched.handle })
    this.panesByRunId.set(launch.runId, panes)
    return { ok: true, handle: launched.handle }
  }

  /** The pane's recent text, for a report node's run-history evidence. */
  async readTail(handle: string): Promise<string[]> {
    try {
      return (await this.runtime.readTerminal(handle, { limit: PANE_TAIL_LIMIT })).tail
    } catch {
      return []
    }
  }

  /** Waits for the agent's own idle edge; the caller decides what proves the turn produced a value. */
  async settle(
    handle: string,
    signal?: AbortSignal
  ): Promise<{ ok: true } | WorkflowPaneTurnRefusal> {
    const observation = await createRuntimeAutomationRunTerminalObserver(
      this.runtime
    ).observeCompletion(handle, {
      signal: signal ?? new AbortController().signal
    })
    if (signal?.aborted) {
      return paneTurnRefusal('cancelled', 'Workflow run was cancelled.', true)
    }
    if (observation.status !== 'completed') {
      return paneTurnRefusal(
        'terminal_agent_did_not_complete',
        observation.error ?? 'The terminal agent did not report completion.',
        true
      )
    }
    return { ok: true }
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
