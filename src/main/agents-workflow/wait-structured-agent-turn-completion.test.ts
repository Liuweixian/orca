import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionTurnCompletionEvent } from '../../shared/agent-session-turn-completion-wire'
import {
  AgentsWorkflowAgentSessionClosedError,
  waitStructuredAgentTurnCompletion
} from './wait-structured-agent-turn-completion'

describe('waitStructuredAgentTurnCompletion', () => {
  it('subscribes before sending and resolves only its session completion', async () => {
    const order: string[] = []
    let emit: (event: AgentSessionTurnCompletionEvent) => void = () => undefined
    const unsubscribe = vi.fn()
    const waiting = waitStructuredAgentTurnCompletion({
      host: {
        subscribeTurnCompletions: (subscriber) => {
          order.push('subscribe')
          emit = subscriber.emit
          return unsubscribe
        }
      },
      sessionId: 'session-1',
      subscriberId: 'workflow-1',
      send: async () => {
        order.push('send')
        return 'sent'
      }
    })
    emit({
      type: 'completion',
      completion: {
        scope: {
          workspaceId: 'workspace-1',
          executionHostId: 'local',
          workspaceKind: 'git-worktree',
          wslDistro: null
        },
        sessionId: 'other',
        turnId: 'other-turn',
        outcome: 'success',
        completedAt: 1
      }
    })
    emit({
      type: 'completion',
      completion: {
        scope: {
          workspaceId: 'workspace-1',
          executionHostId: 'local',
          workspaceKind: 'git-worktree',
          wslDistro: null
        },
        sessionId: 'session-1',
        turnId: 'turn-1',
        outcome: 'success',
        completedAt: 2
      }
    })

    await expect(waiting).resolves.toMatchObject({
      sent: 'sent',
      completion: { turnId: 'turn-1' }
    })
    expect(order).toEqual(['subscribe', 'send'])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects and unsubscribes on abort', async () => {
    const controller = new AbortController()
    const unsubscribe = vi.fn()
    const waiting = waitStructuredAgentTurnCompletion({
      host: { subscribeTurnCompletions: () => unsubscribe },
      sessionId: 'session-1',
      subscriberId: 'workflow-1',
      signal: controller.signal,
      send: async () => 'sent'
    })

    controller.abort(new Error('cancelled'))
    await expect(waiting).rejects.toThrow('cancelled')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects when the chat it awaits is closed, and stops watching then', async () => {
    let reportDeath: (sessionId: string) => void = () => undefined
    const unsubscribeDeath = vi.fn()
    const unsubscribe = vi.fn()
    const waiting = waitStructuredAgentTurnCompletion({
      host: { subscribeTurnCompletions: () => unsubscribe },
      sessionId: 'session-1',
      subscriberId: 'workflow-1',
      send: async () => 'sent',
      onSessionDeath: (listener) => {
        reportDeath = listener
        return unsubscribeDeath
      }
    })

    // Another chat dying says nothing about this node's turn.
    reportDeath('other-session')
    reportDeath('session-1')

    await expect(waiting).rejects.toBeInstanceOf(AgentsWorkflowAgentSessionClosedError)
    expect(unsubscribeDeath).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('leaves a cancel to the abort path when the stop closes the chat', async () => {
    const controller = new AbortController()
    let reportDeath: (sessionId: string) => void = () => undefined
    const waiting = waitStructuredAgentTurnCompletion({
      host: { subscribeTurnCompletions: () => () => undefined },
      sessionId: 'session-1',
      subscriberId: 'workflow-1',
      signal: controller.signal,
      send: async () => 'sent',
      onSessionDeath: (listener) => {
        reportDeath = listener
        return () => undefined
      }
    })

    controller.abort(new Error('cancelled'))
    reportDeath('session-1')

    await expect(waiting).rejects.toThrow('cancelled')
  })
})
