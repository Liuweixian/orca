import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'

export function journalTurnItemIdForProviderTurn(
  items: readonly AgentJournalRenderItem[],
  providerTurnId: string
): string | null {
  return (
    items.find((item) => item.body.kind === 'turn' && item.body.turnId === providerTurnId)
      ?.itemId ?? null
  )
}
