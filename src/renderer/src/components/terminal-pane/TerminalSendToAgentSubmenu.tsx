import { useMemo } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import {
  deriveNotesSendAgentTargets,
  type NotesSendAgentTarget
} from '@/lib/notes-send-agent-targets'
import { selectLivePtyIdsForWorktree } from '@/components/sidebar/worktree-card-status-inputs'
import { translate } from '@/i18n/i18n'

type TerminalSendToAgentSubmenuProps = {
  worktreeId: string
  onSend: (target: NotesSendAgentTarget) => void
}

/** Right-click "Send to Agent" submenu: lists the worktree's running agent
 *  terminals and submits the pane's selected text to the one the user picks. */
export function TerminalSendToAgentSubmenu({
  worktreeId,
  onSend
}: TerminalSendToAgentSubmenuProps): React.JSX.Element {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const unifiedTabsByWorktree = useAppStore((s) => s.unifiedTabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const ptyIdsByTabId = useAppStore(useShallow((s) => selectLivePtyIdsForWorktree(s, worktreeId)))
  const runtimePaneTitlesByTabId = useAppStore((s) => s.runtimePaneTitlesByTabId)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const targets = useMemo(() => {
    // Why: stale-boundary timers bump this epoch without replacing the status
    // map, so eligibility must derive again when freshness flips.
    void agentStatusEpoch
    return deriveNotesSendAgentTargets(
      {
        agentStatusByPaneKey,
        tabsByWorktree,
        unifiedTabsByWorktree,
        terminalLayoutsByTabId,
        ptyIdsByTabId,
        runtimePaneTitlesByTabId
      },
      worktreeId
      // Why: this menu pastes the pane's selected text into a terminal; a
      // structured chat has no pane to read from, so only terminal rows list.
    ).filter((target) => target.messageTarget.kind === 'terminal')
  }, [
    agentStatusEpoch,
    agentStatusByPaneKey,
    tabsByWorktree,
    unifiedTabsByWorktree,
    terminalLayoutsByTabId,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    worktreeId
  ])

  const sendToTarget = (target: NotesSendAgentTarget): void => {
    if (target.status !== 'eligible') {
      return
    }
    // Why: rows come from an open-menu snapshot; re-derive before sending so a
    // pane that closed or went non-sendable reports its current reason.
    const current = deriveNotesSendAgentTargets(useAppStore.getState(), worktreeId).find(
      (candidate) => candidate.paneKey === target.paneKey
    )
    if (!current || current.status !== 'eligible') {
      toast.message(current?.disabledReason ?? 'Terminal is no longer available')
      return
    }
    onSend(current)
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Send />
        {translate('components.terminalPane.TerminalContextMenu.sendToAgent', 'Send to Agent')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        {targets.length === 0 ? (
          <DropdownMenuItem disabled>
            {translate(
              'components.terminalPane.TerminalContextMenu.sendToAgentNoTargets',
              'No running agents'
            )}
          </DropdownMenuItem>
        ) : (
          targets.map((target) => {
            const tabTitle = target.tabTitle.trim()
            const disabledReason = target.status === 'disabled' ? target.disabledReason : undefined
            return (
              <DropdownMenuItem
                key={target.paneKey}
                disabled={target.status !== 'eligible'}
                // Why: surface the ineligibility reason (permission/stale) as a
                // hover tooltip, matching ReviewNotesSendMenuContent's rows.
                title={disabledReason}
                onSelect={() => sendToTarget(target)}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                  <AgentIcon agent={agentTypeToIconAgent(target.agentType)} size={14} />
                </span>
                <span className="grid min-w-0 flex-1 text-left">
                  <span className="truncate">{formatAgentTypeLabel(target.agentType)}</span>
                  {tabTitle ? (
                    <span className="truncate text-[11px] font-normal text-muted-foreground">
                      {tabTitle}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
