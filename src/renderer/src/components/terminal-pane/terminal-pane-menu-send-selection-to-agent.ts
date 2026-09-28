import { toast } from 'sonner'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { translate } from '@/i18n/i18n'
import { track } from '@/lib/telemetry'
import type { NotesSendAgentTarget } from '@/lib/notes-send-agent-targets'
import {
  activeAgentNotesSendFailureMessage,
  sendNotesToActiveAgentSession
} from '@/lib/active-agent-note-send'
import { agentKindForAgentType, formatAgentTypeLabel } from '@/lib/agent-status'
import { readTerminalClipboardSelection } from './terminal-clipboard-selection-text'
import { runTerminalCopy } from './terminal-copy-rejection-guards'

/**
 * Copies the pane's current selection to the clipboard, then submits it as a
 * prompt to the chosen running agent terminal (right-click → Send to Agent).
 */
export const sendTerminalSelectionToAgentTarget = async ({
  pane,
  worktreeId,
  target
}: {
  pane: ManagedPane
  worktreeId: string
  target: NotesSendAgentTarget
}): Promise<void> => {
  const selection = readTerminalClipboardSelection(pane.terminal)
  if (!selection) {
    toast.message(
      translate(
        'components.terminalPane.TerminalContextMenu.sendToAgentNoSelection',
        'No text selected.'
      )
    )
    pane.terminal.focus()
    return
  }

  // Why: the selection must also land on the clipboard, so mirror the Copy
  // item — same writer, swallowed write failure, pane keeps input focus.
  await runTerminalCopy({
    selection,
    writeClipboardText: window.api.ui.writeTerminalClipboardText,
    focus: () => pane.terminal.focus()
  })

  const pending = toast.loading(
    translate(
      'components.terminalPane.TerminalContextMenu.sendToAgentSending',
      'Sending to agent...'
    )
  )
  try {
    const result = await sendNotesToActiveAgentSession({
      worktreeId,
      prompt: selection,
      noteTarget: { tabId: target.tabId, leafId: target.leafId }
    })
    if (result.status === 'sent') {
      toast.success(
        translate(
          'components.terminalPane.TerminalContextMenu.sendToAgentSent',
          'Sent to {{value0}}.',
          { value0: formatAgentTypeLabel(target.agentType) }
        )
      )
      track('agent_prompt_sent', {
        agent_kind: agentKindForAgentType(target.agentType),
        launch_source: 'terminal_context_menu',
        request_kind: 'followup'
      })
      return
    }
    toast.message(
      activeAgentNotesSendFailureMessage(result.status, {
        explicitTarget: true,
        code: result.code
      })
    )
  } catch {
    toast.error(
      activeAgentNotesSendFailureMessage('status-unavailable', {
        explicitTarget: true,
        code: 'runtime-unverifiable'
      })
    )
  } finally {
    toast.dismiss(pending)
  }
}
