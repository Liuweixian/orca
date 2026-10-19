import { describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../shared/agent-session-journal-types'
import { captureAgentsWorkflowStructuredOutput } from './structured-agent-output-capture'

const TURN_ITEM_ID = 'orca:turn-1'
const VISUAL_DIRECTIVE = '::orca-visual{file="report.html" title="Report"}'

function item(
  itemId: string,
  body: AgentJournalItemBody,
  sequence: number,
  options: {
    turnItemId?: string
    agentId?: string
    sequenceIndex?: number
  } = {}
): AgentJournalRenderItem {
  return {
    itemId,
    body,
    sequence,
    revision: 1,
    observedAt: sequence,
    ...(options.turnItemId ? { turnScope: { kind: 'turn', turnItemId: options.turnItemId } } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex })
  }
}

function turn(
  state: 'running' | 'completed' | 'interrupted' | 'unverifiable' = 'completed',
  outcome: 'success' | 'failure' | 'cancellation' | 'superseded' = 'success'
): AgentJournalRenderItem {
  return item(TURN_ITEM_ID, { kind: 'turn', turnId: 'turn-1', state, outcome }, 2)
}

function assistant(
  text: string,
  sequence: number,
  options: {
    turnItemId?: string
    agentId?: string
    state?: 'running' | 'completed'
    sequenceIndex?: number
  } = {}
): AgentJournalRenderItem {
  return item(
    `assistant-${sequence}-${options.sequenceIndex ?? 0}`,
    {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text }],
      ...(options.state ? { state: options.state } : {})
    },
    sequence,
    {
      turnItemId: options.turnItemId ?? TURN_ITEM_ID,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex })
    }
  )
}

describe('captureAgentsWorkflowStructuredOutput', () => {
  it('captures the last root assistant text from a successful completed turn', () => {
    const result = captureAgentsWorkflowStructuredOutput({
      items: [
        turn(),
        assistant('intermediate', 3),
        assistant('subagent result', 5, { agentId: 'child-1' }),
        assistant(`final answer\n\n${VISUAL_DIRECTIVE}`, 5, {
          sequenceIndex: 1,
          state: 'completed'
        }),
        assistant('another turn', 6, { turnItemId: 'orca:turn-2' })
      ],
      turnItemId: TURN_ITEM_ID,
      awaitingUser: false,
      capturedAt: 100
    })

    expect(result).toEqual({
      ok: true,
      output: {
        format: 'plain_text',
        content: 'final answer',
        capturedAt: 100,
        truncated: false,
        source: 'structured_assistant_message'
      }
    })
  })

  it.each([
    {
      name: 'missing turn',
      items: [assistant('answer', 3)],
      reason: 'turn_missing'
    },
    {
      name: 'running turn',
      items: [turn('running'), assistant('partial', 3)],
      reason: 'turn_not_completed'
    },
    {
      name: 'failed turn',
      items: [turn('completed', 'failure'), assistant('error prose', 3)],
      reason: 'turn_not_successful'
    },
    {
      name: 'no root assistant text',
      items: [turn(), assistant('child answer', 3, { agentId: 'child-1' })],
      reason: 'assistant_output_missing'
    },
    {
      name: 'stream still running',
      items: [turn(), assistant('partial', 3, { state: 'running' })],
      reason: 'assistant_output_incomplete'
    }
  ])('fails closed for $name', ({ items, reason }) => {
    expect(
      captureAgentsWorkflowStructuredOutput({
        items,
        turnItemId: TURN_ITEM_ID,
        awaitingUser: false,
        capturedAt: 100
      })
    ).toEqual({ ok: false, reason, output: null })
  })

  it('refuses a successful turn that still awaits user input', () => {
    expect(
      captureAgentsWorkflowStructuredOutput({
        items: [turn(), assistant('choose an option', 3)],
        turnItemId: TURN_ITEM_ID,
        awaitingUser: true,
        capturedAt: 100
      })
    ).toEqual({ ok: false, reason: 'turn_awaiting_user', output: null })
  })

  it('refuses conversation command output', () => {
    const userItemId = 'orca:command'
    expect(
      captureAgentsWorkflowStructuredOutput({
        items: [
          item(
            userItemId,
            {
              kind: 'message',
              role: 'user',
              blocks: [{ type: 'text', text: '/compact' }],
              command: { name: 'compact' }
            },
            1
          ),
          item(
            TURN_ITEM_ID,
            {
              kind: 'turn',
              turnId: 'turn-1',
              state: 'completed',
              outcome: 'success',
              userItemId
            },
            2
          ),
          assistant('Conversation compacted.', 3)
        ],
        turnItemId: TURN_ITEM_ID,
        awaitingUser: false,
        capturedAt: 100
      })
    ).toEqual({ ok: false, reason: 'command_turn', output: null })
  })

  it('stores a UTF-8-safe truncated record but refuses it as a programmable output', () => {
    const result = captureAgentsWorkflowStructuredOutput({
      items: [turn(), assistant('甲乙丙', 3)],
      turnItemId: TURN_ITEM_ID,
      awaitingUser: false,
      capturedAt: 100,
      maxBytes: 7
    })

    expect(result).toEqual({
      ok: false,
      reason: 'output_too_large',
      output: {
        format: 'plain_text',
        content: '甲乙',
        capturedAt: 100,
        truncated: true,
        source: 'structured_assistant_message'
      }
    })
  })
})
