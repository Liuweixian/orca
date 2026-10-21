import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { WorkflowPaneTurns, type WorkflowPaneTurnRuntime } from './workflow-pane-turn'

function statusRow(state: 'working' | 'done', stateStartedAt: number): AgentStatusIpcPayload {
  return {
    paneKey: 'pane-handle-1',
    connectionId: null,
    receivedAt: stateStartedAt,
    stateStartedAt,
    state,
    prompt: ''
  }
}

function runtime(handles: string[], rows: AgentStatusIpcPayload[] = []) {
  let index = 0
  return {
    launchAgentTerminal: vi.fn(async () => {
      const handle = handles[Math.min(index, handles.length - 1)]
      index += 1
      return { handle, paneKey: `pane-${handle}`, worktreeId: 'workspace-1' }
    }),
    closeTerminal: vi.fn(async () => ({ ptyKilled: true })),
    getTerminalHandleForPaneKey: vi.fn(() => null),
    waitForTerminal: vi.fn(async () => ({ satisfied: true })),
    readTerminal: vi.fn(async () => ({ tail: [] as string[] })),
    getAgentStatusRowsForPane: vi.fn(() => rows)
  }
}

function panesFor(rig: ReturnType<typeof runtime>): WorkflowPaneTurns {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the class only calls these six runtime methods.
  return new WorkflowPaneTurns(rig as unknown as WorkflowPaneTurnRuntime)
}

const work = {
  runId: 'run-1',
  nodeId: 'agent-1',
  workspaceId: 'workspace-1',
  agent: 'aider',
  prompt: 'work'
} as const

describe('WorkflowPaneTurns', () => {
  it('closes the previous pane when a node is retried', async () => {
    const rig = runtime(['handle-1', 'handle-2'])
    const panes = panesFor(rig)

    await panes.launch(work)
    const retried = await panes.launch(work)

    expect(retried).toMatchObject({ ok: true, handle: 'handle-2', paneKey: 'pane-handle-2' })
    expect(rig.closeTerminal).toHaveBeenCalledWith('handle-1')
    // Only the live pane is tracked, so release closes it once.
    await panes.release('run-1', { reclaim: true })
    expect(rig.closeTerminal).toHaveBeenCalledTimes(2)
    expect(rig.closeTerminal).toHaveBeenLastCalledWith('handle-2')
  })

  // Why: a fresh TUI paints its composer and reads idle seconds after the prompt goes in. Trusting
  // that edge failed a three-minute review node 12s after launch with output_contract_missing,
  // while the agent was still working.
  it('waits for the agent to report done instead of the pane going idle', async () => {
    vi.useFakeTimers()
    try {
      const rows: AgentStatusIpcPayload[] = [statusRow('working', 1)]
      const rig = runtime(['handle-1'], rows)
      const panes = panesFor(rig)

      const launched = await panes.launch(work)
      expect(launched.ok).toBe(true)
      if (!launched.ok) {
        return
      }
      let settled = false
      const pending = panes.settle(launched).then((result) => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(10_000)
      expect(settled).toBe(false)

      rows.push(statusRow('done', Date.now()))
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(pending).resolves.toEqual({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a done row that predates this turn', async () => {
    vi.useFakeTimers()
    try {
      const rig = runtime(
        ['handle-1'],
        [
          // A reused pane's previous turn ended before this one was dispatched.
          statusRow('done', 1)
        ]
      )
      const panes = panesFor(rig)
      const launched = await panes.launch(work)
      if (!launched.ok) {
        throw new Error('launch refused')
      }

      let settled = false
      void panes.settle(launched).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(settled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Why: a pane closed or reloaded mid-turn made the wait reject. Letting that throw escaped the
  // scheduler, failed the run with `workflow_execution_failed`, and left the attempt `running`.
  it('reports a lost pane as unverifiable instead of throwing', async () => {
    const rig = runtime(['handle-1'])
    rig.waitForTerminal.mockRejectedValue(new Error('terminal_handle_stale'))
    const panes = panesFor(rig)
    const launched = await panes.launch(work)
    if (!launched.ok) {
      throw new Error('launch refused')
    }

    await expect(panes.settle(launched)).resolves.toMatchObject({
      ok: false,
      code: 'terminal_agent_unverifiable',
      unverifiable: true,
      message: expect.stringContaining('terminal_handle_stale') as unknown as string
    })
  })
})
