import { describe, expect, it, vi } from 'vitest'
import { WorkflowPaneTurns, type WorkflowPaneTurnRuntime } from './workflow-pane-turn'

function runtime(handles: string[]): WorkflowPaneTurnRuntime {
  let index = 0
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the class only calls these five runtime methods.
  return {
    launchAgentTerminal: vi.fn(async () => {
      const handle = handles[Math.min(index, handles.length - 1)]
      index += 1
      return { handle, paneKey: handle, worktreeId: 'workspace-1' }
    }),
    closeTerminal: vi.fn(async () => ({ ptyKilled: true })),
    getTerminalHandleForPaneKey: vi.fn(() => null),
    waitForTerminal: vi.fn(async () => ({ satisfied: true })),
    readTerminal: vi.fn(async () => ({ tail: [] }))
  } as unknown as WorkflowPaneTurnRuntime
}

describe('WorkflowPaneTurns', () => {
  it('closes the previous pane when a node is retried', async () => {
    const rig = runtime(['handle-1', 'handle-2'])
    const panes = new WorkflowPaneTurns(rig)

    await panes.launch({
      runId: 'run-1',
      nodeId: 'agent-1',
      workspaceId: 'workspace-1',
      agent: 'aider',
      prompt: 'work'
    })
    const retried = await panes.launch({
      runId: 'run-1',
      nodeId: 'agent-1',
      workspaceId: 'workspace-1',
      agent: 'aider',
      prompt: 'work'
    })

    expect(retried).toEqual({ ok: true, handle: 'handle-2' })
    expect(rig.closeTerminal).toHaveBeenCalledWith('handle-1')
    // Only the live pane is tracked, so release closes it once.
    await panes.release('run-1', { reclaim: true })
    expect(rig.closeTerminal).toHaveBeenCalledTimes(2)
    expect(rig.closeTerminal).toHaveBeenLastCalledWith('handle-2')
  })
})
