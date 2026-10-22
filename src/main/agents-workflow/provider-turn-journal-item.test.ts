import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { journalTurnItemIdForProviderTurn } from './provider-turn-journal-item'

function turn(itemId: string, turnId: string): AgentJournalRenderItem {
  return {
    itemId,
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'turn', turnId, state: 'completed', outcome: 'success' }
  }
}

describe('journalTurnItemIdForProviderTurn', () => {
  it('maps the provider turn id to the reduced journal item id', () => {
    expect(journalTurnItemIdForProviderTurn([turn('item-1', 'provider-1')], 'provider-1')).toBe(
      'item-1'
    )
  })

  it('fails closed when the completed turn is absent', () => {
    expect(journalTurnItemIdForProviderTurn([], 'provider-1')).toBeNull()
  })
})
