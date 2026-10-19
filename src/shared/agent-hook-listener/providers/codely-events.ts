import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../agent-status-types'
import type { HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState } from '../prompt-fields'
import { extractToolFields, isNewTurnEvent } from '../provider-event-routing'
import { readString } from '../tool-input-preview'

// Why: Codely is a Gemini CLI fork, so its hook payloads reuse Gemini's field names
// (prompt, tool_name/tool_input, prompt_response) and native event names; only the
// agent attribution differs. It additionally fires Notification with
// notification_type "ToolPermission" when the TUI waits on an approval.
export function normalizeCodelyEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  // Why: Notification also fires for Scheduled runtime-hook triggers, which are not
  // user attention — only a ToolPermission ping means the TUI is waiting on the user.
  const isToolPermissionNotification =
    eventName === 'Notification' &&
    readString(hookPayload, 'notification_type') === 'ToolPermission'

  const stateName =
    eventName === 'BeforeAgent' ||
    eventName === 'BeforeTool' ||
    eventName === 'AfterTool' ||
    eventName === 'AfterToolFailure'
      ? 'working'
      : isToolPermissionNotification
        ? 'waiting'
        : eventName === 'AfterAgent'
          ? 'done'
          : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('codely', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('codely', eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    // Why: a ToolPermission Notification's `message` is status copy, not the user's
    // ask — keep the cached turn prompt instead of letting it pollute the prompt line.
    prompt: resolvePrompt(state, paneKey, isToolPermissionNotification ? '' : promptText, {
      resetOnNewTurn: isNewTurnEvent('codely', eventName)
    }),
    agentType: 'codely',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput
  })
}
