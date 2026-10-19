import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionTurnCompletionEvent } from '../../shared/agent-session-turn-completion-wire'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { WorkflowStructuredTurnRunner } from './workflow-structured-turn-runner'

const lifecycle = vi.hoisted<{
  close: ReturnType<typeof vi.fn>
  status: 'live' | 'unverifiable' | 'exited'
}>(() => ({
  close: vi.fn(async () => ({ stopped: true, closeAttempted: true })),
  status: 'exited'
}))

vi.mock('../runtime/structured-agent-runtime-metadata', () => ({
  structuredAgentRuntimeMetadata: (agent: string) =>
    agent === 'claude' ? { definition: { agent: 'claude' } } : null
}))
vi.mock('../runtime/structured-agent-session-close', () => ({
  closeStructuredAgentSessionChild: lifecycle.close
}))
vi.mock('../runtime/structured-worker-authority', () => ({
  observeStructuredSession: () => ({ status: lifecycle.status })
}))

function turnItem(): AgentJournalRenderItem {
  return {
    itemId: 'turn-item-1',
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'turn', turnId: 'provider-turn-1', state: 'completed', outcome: 'success' }
  }
}

function agentInput(signal?: AbortSignal) {
  return {
    runId: 'run-1',
    workspaceId: 'workspace-1',
    node: {
      id: 'agent-1',
      kind: 'agent' as const,
      title: 'Agent',
      position: { x: 0, y: 0 },
      agentId: 'claude' as const,
      prompt: { source: 'work', bindings: {} },
      terminal: false
    },
    prompt: 'work',
    signal
  }
}

function harness() {
  let emit: (event: AgentSessionTurnCompletionEvent) => void = () => undefined
  const host = {
    subscribeTurnCompletions: vi.fn((subscriber) => {
      emit = subscriber.emit
      return () => undefined
    }),
    send: vi.fn(async () => ({
      ok: true as const,
      replayed: false,
      fence: 7,
      cursor: { epoch: 'epoch-1', sequence: 1 },
      value: {
        clientMessageId: 'message-1',
        queued: { messageId: 'queued-1', position: 1, state: 'waiting' as const }
      }
    })),
    journalSnapshot: vi.fn(async () => ({
      sessionId: 'session-1',
      cursor: { epoch: 'epoch-1', sequence: 2 },
      items: [turnItem()],
      submissions: []
    })),
    cancel: vi.fn(async () => ({
      ok: true as const,
      replayed: false,
      fence: 8,
      cursor: { epoch: 'epoch-1', sequence: 2 },
      value: { cancelled: true }
    }))
  }
  const runtime = {
    ensureStructuredAgentSessionHost: vi.fn(async () => undefined),
    getStructuredAgentSessionCreateSupport: vi.fn(async () => ({ supported: true }))
  }
  const createSession = vi.fn(async () => ({
    ok: true as const,
    value: { sessionId: 'session-1', fence: 7 }
  }))
  return {
    emit,
    getEmit: () => emit,
    host,
    runtime,
    createSession,
    runner: new WorkflowStructuredTurnRunner(runtime, createSession, () => host)
  }
}

describe('WorkflowStructuredTurnRunner', () => {
  it('creates a hidden session and captures the completed provider turn', async () => {
    const rig = harness()
    const running = rig.runner.run(agentInput())
    await vi.waitFor(() => expect(rig.host.send).toHaveBeenCalledOnce())
    rig.getEmit()({
      type: 'completion',
      completion: {
        scope: {
          workspaceId: 'workspace-1',
          executionHostId: 'local',
          workspaceKind: 'git-worktree',
          wslDistro: null
        },
        sessionId: 'session-1',
        turnId: 'provider-turn-1',
        outcome: 'success',
        completedAt: 9
      }
    })

    await expect(running).resolves.toMatchObject({
      ok: true,
      turnItemId: 'turn-item-1',
      awaitingUser: false,
      capturedAt: 9
    })
    expect(rig.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ caller: { callerKey: 'agents-workflow:run-1' } })
    )
  })

  it('reports stopped only when cancellation observes an exited child', async () => {
    const controller = new AbortController()
    const rig = harness()
    const running = rig.runner.run(agentInput(controller.signal))
    await vi.waitFor(() => expect(rig.host.send).toHaveBeenCalledOnce())

    lifecycle.status = 'exited'
    await expect(rig.runner.cancel('run-1')).resolves.toBe('stopped')
    expect(rig.host.cancel).toHaveBeenCalledOnce()
    controller.abort(new Error('cancelled'))
    await running

    const second = harness()
    const secondRunning = second.runner.run(agentInput())
    await vi.waitFor(() => expect(second.host.send).toHaveBeenCalledOnce())
    lifecycle.status = 'unverifiable'
    await expect(second.runner.cancel('run-1')).resolves.toBe('unverifiable')
    second.getEmit()({ type: 'end' })
    await secondRunning
  })
})
