import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { WorkflowFileHandoffTurnRunner } from './workflow-file-handoff-runner'

const observer = vi.hoisted(() => ({
  observeCompletion: vi.fn(
    async (): Promise<{
      status: 'completed' | 'dispatch_failed'
      outputSnapshot: null
      error: string | null
    }> => ({ status: 'completed', outputSnapshot: null, error: null })
  )
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

/** The agent answers by writing the file the prompt names, exactly as a real one would. */
function answersWith(rig: ReturnType<typeof runtime>, content: string): void {
  rig.launchAgentTerminal.mockImplementation(async (_selector, options) => {
    const path = options.prompt.split('\n').find((line) => line.includes('.orca-workflow'))
    if (path) {
      await writeFile(path, content)
    }
    return { handle: 'handle-1', paneKey: 'pane-1', worktreeId: 'workspace-1' }
  })
}

async function workspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'orca-workflow-'))
}

afterEach(() => {
  observer.observeCompletion.mockReset()
  observer.observeCompletion.mockImplementation(async () => ({
    status: 'completed' as const,
    outputSnapshot: null,
    error: null
  }))
})

describe('WorkflowFileHandoffTurnRunner', () => {
  it('asks for a file and reads the value the agent wrote', async () => {
    const dir = await workspace()
    const rig = runtime()
    answersWith(rig, 'the answer')
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService
    )

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({
      ok: true,
      output: { source: 'agent_file_handoff', content: 'the answer', truncated: false }
    })
    expect(rig.launchAgentTerminal).toHaveBeenCalledWith(
      'id:workspace-1',
      expect.objectContaining({ agent: 'aider' })
    )
    await rm(dir, { recursive: true, force: true })
  })

  it('fails when the agent finishes without writing the file', async () => {
    const dir = await workspace()
    const rig = runtime()
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      0,
      1
    )

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'output_contract_missing' })
    await rm(dir, { recursive: true, force: true })
  })

  it('gives a settled pane only a short grace period instead of the full timeout', async () => {
    const dir = await workspace()
    const rig = runtime()
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      60_000,
      5,
      20
    )
    const startedAt = Date.now()

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'output_contract_missing' })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts the answer an agent wrote before its pane was lost', async () => {
    const dir = await workspace()
    const rig = runtime()
    // The pane closes right after the agent wrote the file; the file is still the proof.
    observer.observeCompletion.mockResolvedValue({
      status: 'dispatch_failed' as const,
      outputSnapshot: null,
      error: 'The workflow pane stopped reporting before the agent finished: terminal_handle_stale'
    })
    answersWith(rig, 'the answer')
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      5_000,
      10,
      200,
      10
    )

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { content: 'the answer' } })
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a lost pane as unverifiable instead of waiting out the file timeout', async () => {
    const dir = await workspace()
    const rig = runtime()
    observer.observeCompletion.mockResolvedValue({
      status: 'dispatch_failed' as const,
      outputSnapshot: null,
      error: 'The workflow pane stopped reporting before the agent finished: terminal_handle_stale'
    })
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      60_000,
      10,
      20
    )
    const startedAt = Date.now()

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, unverifiable: true })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a cancelled run as cancelled rather than as a missing file', async () => {
    const dir = await workspace()
    const rig = runtime()
    let settle: () => void = () => undefined
    observer.observeCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({ status: 'completed' as const, outputSnapshot: null, error: null })
        })
    )
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      5_000,
      10
    )
    const controller = new AbortController()

    const running = runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work',
      signal: controller.signal
    })
    await vi.waitFor(() => expect(rig.launchAgentTerminal).toHaveBeenCalledOnce())
    controller.abort()
    settle()

    await expect(running).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps waiting after the pane reports idle, because the file is the proof', async () => {
    const dir = await workspace()
    const rig = runtime()
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      5_000,
      10
    )
    // The pane looks idle the moment it exists; the agent is still working.
    rig.launchAgentTerminal.mockImplementation(async (_selector, options) => {
      const path = options.prompt.split('\n').find((line) => line.includes('.orca-workflow'))
      setTimeout(() => {
        if (path) {
          void writeFile(path, 'late but real')
        }
      }, 300)
      return { handle: 'handle-1', paneKey: 'pane-1', worktreeId: 'workspace-1' }
    })

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { content: 'late but real' } })
    await rm(dir, { recursive: true, force: true })
  })

  it('does not hand a half-written answer downstream', async () => {
    const dir = await workspace()
    const rig = runtime()
    // The agent writes a skeleton first and the real answer a moment later.
    rig.launchAgentTerminal.mockImplementation(async (_selector, options) => {
      const path = options.prompt.split('\n').find((line) => line.includes('.orca-workflow'))
      if (path) {
        await writeFile(path, 'draft')
        setTimeout(() => void writeFile(path, 'the final answer'), 50)
      }
      return { handle: 'handle-1', paneKey: 'pane-1', worktreeId: 'workspace-1' }
    })
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      5_000,
      10,
      1_000,
      150
    )

    const result = await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { content: 'the final answer' } })
    await rm(dir, { recursive: true, force: true })
  })

  it('waits for the pane to settle before accepting a file', async () => {
    const dir = await workspace()
    const rig = runtime()
    answersWith(rig, 'written early')
    let settle: () => void = () => undefined
    observer.observeCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({ status: 'completed' as const, outputSnapshot: null, error: null })
        })
    )
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      5_000,
      10,
      20,
      10
    )

    const running = runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })
    await vi.waitFor(() => expect(rig.launchAgentTerminal).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 100))
    settle()

    await expect(running).resolves.toMatchObject({ ok: true })
    await rm(dir, { recursive: true, force: true })
  })

  it('closes the pane a cancelled run left open', async () => {
    const dir = await workspace()
    const rig = runtime()
    let settle: () => void = () => undefined
    observer.observeCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({ status: 'completed' as const, outputSnapshot: null, error: null })
        })
    )
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService,
      Date.now,
      0,
      1
    )

    const controller = new AbortController()
    const running = runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work',
      signal: controller.signal
    })
    await vi.waitFor(() => expect(rig.launchAgentTerminal).toHaveBeenCalledOnce())

    await expect(runner.cancel('run-1')).resolves.toBe('stopped')
    expect(rig.closeTerminal).toHaveBeenCalledWith('handle-1')
    controller.abort()
    settle()
    await running
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps the delivered file when a run is reclaimed', async () => {
    const dir = await workspace()
    const rig = runtime()
    answersWith(rig, 'the answer')
    const runner = new WorkflowFileHandoffTurnRunner(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner reads only the five terminal methods this fixture provides.
      rig as unknown as OrcaRuntimeService
    )
    await runner.run({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: dir,
      node: node(),
      prompt: 'work'
    })

    await runner.release('run-1', { reclaim: true })

    // The agent's own deliverable is never the engine's to delete.
    expect(existsSync(join(dir, '.orca-workflow', 'run-1'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})
