import type {
  AgentJournalRenderItem,
  AgentJournalTurnItem
} from '../../shared/agent-session-journal-types'
import { isRootAgentJournalItem } from '../../shared/agent-session-journal-producer'
import { withoutNativeChatVisualDirectiveLines } from '../../shared/native-chat-visual-directive'
import { structuredAgentSessionCommandTurnItemIds } from '../../shared/structured-agent-session-command-entry'
import { clampUtf8TextPrefix, isUtf8ByteLengthWithinLimit } from '../../shared/utf8-byte-limits'

export const AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES = 1024 * 1024

export type AgentsWorkflowStructuredOutput = {
  format: 'plain_text'
  content: string
  capturedAt: number
  truncated: boolean
  source: 'structured_assistant_message'
}

export type AgentsWorkflowStructuredOutputCapture =
  | { ok: true; output: AgentsWorkflowStructuredOutput }
  | {
      ok: false
      reason:
        | 'turn_missing'
        | 'turn_not_completed'
        | 'turn_not_successful'
        | 'turn_awaiting_user'
        | 'command_turn'
        | 'assistant_output_missing'
        | 'assistant_output_incomplete'
        | 'output_too_large'
      output: AgentsWorkflowStructuredOutput | null
    }

function outputOf(
  content: string,
  capturedAt: number,
  truncated: boolean
): AgentsWorkflowStructuredOutput {
  return {
    format: 'plain_text',
    content,
    capturedAt,
    truncated,
    source: 'structured_assistant_message'
  }
}

function turnOf(
  items: readonly AgentJournalRenderItem[],
  turnItemId: string
): AgentJournalTurnItem | null {
  const item = items.find((candidate) => candidate.itemId === turnItemId)
  return item?.body.kind === 'turn' ? item.body : null
}

function positionOf(item: AgentJournalRenderItem): [number, number] {
  return [item.sequence, item.sequenceIndex ?? 0]
}

function isAfter(candidate: AgentJournalRenderItem, current: AgentJournalRenderItem): boolean {
  const [candidateSequence, candidateIndex] = positionOf(candidate)
  const [currentSequence, currentIndex] = positionOf(current)
  return (
    candidateSequence > currentSequence ||
    (candidateSequence === currentSequence && candidateIndex > currentIndex)
  )
}

function assistantText(item: AgentJournalRenderItem, turnItemId: string): string | null {
  const { body, turnScope } = item
  if (
    !isRootAgentJournalItem(item) ||
    turnScope?.kind !== 'turn' ||
    turnScope.turnItemId !== turnItemId ||
    body.kind !== 'message' ||
    body.role !== 'assistant'
  ) {
    return null
  }
  const text = body.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  const prose = withoutNativeChatVisualDirectiveLines(text)
  return prose.trim().length > 0 ? prose : null
}

export function captureAgentsWorkflowStructuredOutput(input: {
  items: readonly AgentJournalRenderItem[]
  turnItemId: string
  awaitingUser: boolean
  capturedAt: number
  maxBytes?: number
}): AgentsWorkflowStructuredOutputCapture {
  const turn = turnOf(input.items, input.turnItemId)
  if (!turn) {
    return { ok: false, reason: 'turn_missing', output: null }
  }
  if (turn.state !== 'completed') {
    return { ok: false, reason: 'turn_not_completed', output: null }
  }
  if (turn.outcome !== 'success') {
    return { ok: false, reason: 'turn_not_successful', output: null }
  }
  if (input.awaitingUser) {
    return { ok: false, reason: 'turn_awaiting_user', output: null }
  }
  if (structuredAgentSessionCommandTurnItemIds(input.items).has(input.turnItemId)) {
    return { ok: false, reason: 'command_turn', output: null }
  }

  let latest: AgentJournalRenderItem | null = null
  let content: string | null = null
  for (const item of input.items) {
    const text = assistantText(item, input.turnItemId)
    if (text !== null && (!latest || isAfter(item, latest))) {
      latest = item
      content = text
    }
  }
  if (!latest || content === null) {
    return { ok: false, reason: 'assistant_output_missing', output: null }
  }
  if (latest.body.kind === 'message' && latest.body.state === 'running') {
    return { ok: false, reason: 'assistant_output_incomplete', output: null }
  }

  const maxBytes = input.maxBytes ?? AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES
  if (!isUtf8ByteLengthWithinLimit(content, maxBytes)) {
    return {
      ok: false,
      reason: 'output_too_large',
      output: outputOf(clampUtf8TextPrefix(content, maxBytes), input.capturedAt, true)
    }
  }
  return { ok: true, output: outputOf(content, input.capturedAt, false) }
}
