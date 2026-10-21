import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { WorkflowTranscriptTurnRunner } from './workflow-transcript-turn-runner'

const observer = vi.hoisted(() => ({
  observeCompletion: vi.fn(async () => ({
    status: 'completed' as const,
    outputSnapshot: null,
    error: null
  }))
}))

vi.mock('../automations/runtime-terminal-run-observer', () => ({
  createRuntimeAutomationRunTerminalObserver: () => observer
}))

type Node = {
  id: string
  kind: 'agent'
  title: string
  position: { x: number; y: number }
  agentId: 'gemini' | 'aider'
  prompt: { source: string; bindings: Record<string, never> }
  terminal: boolean
}

function node(agentId: Node['agentId'] = 'gemini'): Node {
  return {
    id: 'agent-1',
    kind: 'agent',
    title: 'Agent',
    position: { x: 0, y: 0 },
    agentId,
    prompt: { source: 'work', bindings: {} },
    terminal: false
  }
}

function runtime() {
  return {
    launchAgentTerminal: vi.fn(async (_selector: string, _options: { prompt: string }) => ({
      handle: 'handle-1',
      paneKey: 'pane-1',
      worktreeId: 'workspace-1'
    })),
    closeTerminal: vi.fn(async () => ({ ptyKilled: true })),
    getTerminalHandleForPaneKey: vi.fn(() => 'handle-1'),
    waitForTerminal: vi.fn(async () => ({ satisfied: true })),
    readTerminal: vi.fn(async () => ({ tail: [] }))
  }
}

function asRuntime(rig: ReturnType<typeof runtime>): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
  return rig as unknown as OrcaRuntimeService
}

beforeEach(() => {
  observer.observeCompletion.mockReset()
  observer.observeCompletion.mockImplementation(async () => ({
    status: 'completed' as const,
    outputSnapshot: null,
    error: null
  }))
})

describe('WorkflowTranscriptTurnRunner', () => {
  it('sends the prompt unmodified and reads the answer from the transcript', async () => {
    const rig = runtime()
    const readTurn = vi.fn(async () => ({ ok: true as const, content: 'the answer' }))
    const runner = new WorkflowTranscriptTurnRunner(asRuntime(rig), readTurn)

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/worktree',
      node: node(),
      prompt: 'review the diff'
    })

    expect(result).toMatchObject({
      ok: true,
      output: { source: 'agent_transcript', content: 'the answer' }
    })
    // Nothing is appended: the whole point of this channel is leaving the prompt alone.
    expect(rig.launchAgentTerminal).toHaveBeenCalledWith(
      'id:workspace-1',
      expect.objectContaining({ agent: 'gemini', prompt: 'review the diff' })
    )
    expect(readTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff'
      })
    )
  })

  it('refuses with an unavailable code so the adapter can fall through to the file', async () => {
    const rig = runtime()
    const readTurn = vi.fn(async () => ({ ok: false as const, message: 'no session matched' }))
    const runner = new WorkflowTranscriptTurnRunner(asRuntime(rig), readTurn)

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/worktree',
      node: node(),
      prompt: 'review the diff'
    })

    expect(result).toMatchObject({ ok: false, code: 'transcript_turn_unavailable' })
  })

  it('refuses an agent that leaves no readable transcript without launching a pane', async () => {
    const rig = runtime()
    const runner = new WorkflowTranscriptTurnRunner(asRuntime(rig), vi.fn())

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/worktree',
      node: node('aider'),
      prompt: 'review the diff'
    })

    expect(result).toMatchObject({ ok: false, code: 'transcript_channel_unavailable' })
    expect(rig.launchAgentTerminal).not.toHaveBeenCalled()
  })

  it('reports a cancelled turn as cancelled, not as an unreadable transcript', async () => {
    const rig = runtime()
    const readTurn = vi.fn(async () => ({ ok: false as const, message: 'aborted' }))
    const runner = new WorkflowTranscriptTurnRunner(asRuntime(rig), readTurn)
    const controller = new AbortController()
    controller.abort()

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/worktree',
      node: node(),
      prompt: 'review the diff',
      signal: controller.signal
    })

    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('closes the pane a cancelled run left open', async () => {
    const rig = runtime()
    let settle: () => void = () => undefined
    observer.observeCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({ status: 'completed' as const, outputSnapshot: null, error: null })
        })
    )
    const runner = new WorkflowTranscriptTurnRunner(
      asRuntime(rig),
      vi.fn(async () => ({ ok: false as const, message: 'closed' }))
    )

    const running = runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/worktree',
      node: node(),
      prompt: 'review the diff'
    })
    await vi.waitFor(() => expect(rig.launchAgentTerminal).toHaveBeenCalledOnce())

    await expect(runner.cancel('run-1')).resolves.toBe('stopped')
    expect(rig.closeTerminal).toHaveBeenCalledWith('handle-1')
    settle()
    await running
  })
})
