import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { WorkflowReportTurnRunner } from './workflow-report-turn-runner'

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
  agentId: 'aider'
  prompt: { source: string; bindings: Record<string, never> }
  terminal: boolean
}

function node(): Node {
  return {
    id: 'agent-1',
    kind: 'agent',
    title: 'Agent',
    position: { x: 0, y: 0 },
    agentId: 'aider',
    prompt: { source: 'work', bindings: {} },
    terminal: false
  }
}

function runtime(tails: string[][]) {
  let index = 0
  return {
    launchAgentTerminal: vi.fn(async (_selector: string, _options: { prompt: string }) => ({
      handle: 'handle-1',
      paneKey: 'pane-1',
      worktreeId: 'workspace-1'
    })),
    closeTerminal: vi.fn(async () => ({ ptyKilled: true })),
    getTerminalHandleForPaneKey: vi.fn(() => 'handle-1'),
    waitForTerminal: vi.fn(async () => ({ satisfied: true })),
    readTerminal: vi.fn(async () => {
      const tail = tails[Math.min(index, tails.length - 1)] ?? []
      index += 1
      return { tail }
    })
  }
}

function asRuntime(rig: ReturnType<typeof runtime>): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
  return rig as unknown as OrcaRuntimeService
}

describe('WorkflowReportTurnRunner', () => {
  it('runs the prompt untouched and records what the pane said', async () => {
    const rig = runtime([
      ['first frame'],
      ['the answer', 'second line'],
      ['the answer', 'second line']
    ])
    const runner = new WorkflowReportTurnRunner(asRuntime(rig))

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node(),
      prompt: 'summarize the diff'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'terminal_snapshot' } })
    expect(result.ok && result.output.content).toContain('the answer')
    // A report node hands nothing downstream, so its prompt carries no output contract.
    expect(rig.launchAgentTerminal).toHaveBeenCalledWith(
      'id:workspace-1',
      expect.objectContaining({ prompt: 'summarize the diff' })
    )
  })

  it('closes the pane a cancelled run left open', async () => {
    const rig = runtime([[]])
    let settle: () => void = () => undefined
    observer.observeCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({ status: 'completed' as const, outputSnapshot: null, error: null })
        })
    )
    const runner = new WorkflowReportTurnRunner(asRuntime(rig))
    const controller = new AbortController()

    const running = runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node(),
      prompt: 'summarize the diff',
      signal: controller.signal
    })
    await vi.waitFor(() => expect(rig.launchAgentTerminal).toHaveBeenCalledOnce())

    await expect(runner.cancel('run-1')).resolves.toBe('stopped')
    expect(rig.closeTerminal).toHaveBeenCalledWith('handle-1')
    controller.abort()
    settle()
    await running
  })
})
