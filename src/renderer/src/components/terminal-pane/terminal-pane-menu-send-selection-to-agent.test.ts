// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { NotesSendAgentTarget } from '@/lib/notes-send-agent-targets'

const settings: { current: Record<string, unknown> } = { current: {} }
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: settings.current }) }
}))

const harness = vi.hoisted(() => ({
  sendNotesToActiveAgentSession: vi.fn(),
  track: vi.fn(),
  writeTerminalClipboardText: vi.fn(),
  toastLoading: vi.fn(() => 'pending-toast-id'),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    loading: harness.toastLoading,
    success: harness.toastSuccess,
    message: harness.toastMessage,
    error: harness.toastError,
    dismiss: harness.toastDismiss
  }
}))

vi.mock('@/lib/active-agent-note-send', () => ({
  sendNotesToActiveAgentSession: harness.sendNotesToActiveAgentSession,
  activeAgentNotesSendFailureMessage: (
    status: string,
    options: { explicitTarget?: boolean; code?: string } = {}
  ) =>
    `failure:${options.explicitTarget ? 'selected' : 'active'}:${status}:${options.code ?? 'none'}`
}))

vi.mock('@/lib/telemetry', () => ({ track: harness.track }))

vi.mock('@/i18n/i18n', () => ({
  translate: vi.fn((_key: string, fallback: string, options?: { value0?: string }) =>
    options?.value0 !== undefined ? fallback.replace('{{value0}}', options.value0) : fallback
  )
}))

const { sendTerminalSelectionToAgentTarget } =
  await import('./terminal-pane-menu-send-selection-to-agent')

const WORKTREE_ID = 'wt-menu-send'

const TARGET: NotesSendAgentTarget = {
  paneKey: 'tab-a|leaf-b',
  tabId: 'tab-a',
  messageTarget: { kind: 'terminal', tabId: 'tab-a', leafId: 'leaf-b' },
  agentType: 'claude',
  tabTitle: 'Bug bash',
  status: 'eligible'
}

function makePane(selection: string): ManagedPane {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the send action only reads terminal.getSelection() and calls terminal.focus(); the fixture supplies exactly those members.
  return {
    terminal: {
      getSelection: vi.fn(() => selection),
      focus: vi.fn()
    }
  } as unknown as ManagedPane
}

beforeEach(() => {
  settings.current = {}
  harness.sendNotesToActiveAgentSession.mockReset()
  harness.track.mockReset()
  harness.writeTerminalClipboardText.mockReset().mockResolvedValue(undefined)
  harness.toastLoading.mockClear()
  harness.toastSuccess.mockClear()
  harness.toastMessage.mockClear()
  harness.toastError.mockClear()
  harness.toastDismiss.mockClear()
  Object.assign(window, {
    api: { ui: { writeTerminalClipboardText: harness.writeTerminalClipboardText } }
  })
})

describe('sendTerminalSelectionToAgentTarget', () => {
  it('reports an empty selection without copying or sending', async () => {
    const pane = makePane('')

    await sendTerminalSelectionToAgentTarget({ pane, worktreeId: WORKTREE_ID, target: TARGET })

    expect(harness.writeTerminalClipboardText).not.toHaveBeenCalled()
    expect(harness.sendNotesToActiveAgentSession).not.toHaveBeenCalled()
    expect(harness.toastMessage).toHaveBeenCalledWith('No text selected.')
    expect(pane.terminal.focus).toHaveBeenCalled()
  })

  it('copies the selection, then submits it as a prompt to the chosen agent', async () => {
    const pane = makePane('copilot answer')
    harness.sendNotesToActiveAgentSession.mockResolvedValue({ status: 'sent' })

    await sendTerminalSelectionToAgentTarget({ pane, worktreeId: WORKTREE_ID, target: TARGET })

    expect(harness.writeTerminalClipboardText).toHaveBeenCalledWith('copilot answer')
    expect(harness.sendNotesToActiveAgentSession).toHaveBeenCalledWith({
      worktreeId: WORKTREE_ID,
      prompt: 'copilot answer',
      noteTarget: { tabId: 'tab-a', leafId: 'leaf-b' }
    })
    expect(harness.toastSuccess).toHaveBeenCalledWith('Sent to Claude.')
    expect(harness.track).toHaveBeenCalledWith('agent_prompt_sent', {
      agent_kind: 'claude-code',
      launch_source: 'terminal_context_menu',
      request_kind: 'followup'
    })
    expect(harness.toastDismiss).toHaveBeenCalledWith('pending-toast-id')
  })

  it('still sends when the clipboard copy fails', async () => {
    const pane = makePane('copilot answer')
    harness.writeTerminalClipboardText.mockRejectedValue(new Error('clipboard refused'))
    harness.sendNotesToActiveAgentSession.mockResolvedValue({ status: 'sent' })

    await sendTerminalSelectionToAgentTarget({ pane, worktreeId: WORKTREE_ID, target: TARGET })

    expect(harness.sendNotesToActiveAgentSession).toHaveBeenCalledTimes(1)
    expect(harness.toastSuccess).toHaveBeenCalledWith('Sent to Claude.')
  })

  it('reports a refused send without claiming success', async () => {
    const pane = makePane('copilot answer')
    harness.sendNotesToActiveAgentSession.mockResolvedValue({
      status: 'permission',
      code: 'agent-permission'
    })

    await sendTerminalSelectionToAgentTarget({ pane, worktreeId: WORKTREE_ID, target: TARGET })

    expect(harness.toastSuccess).not.toHaveBeenCalled()
    expect(harness.track).not.toHaveBeenCalled()
    expect(harness.toastMessage).toHaveBeenCalledWith(
      'failure:selected:permission:agent-permission'
    )
    expect(harness.toastDismiss).toHaveBeenCalledWith('pending-toast-id')
  })

  it('surfaces a thrown send as an unverifiable runtime failure', async () => {
    const pane = makePane('copilot answer')
    harness.sendNotesToActiveAgentSession.mockRejectedValue(new Error('rpc gone'))

    await sendTerminalSelectionToAgentTarget({ pane, worktreeId: WORKTREE_ID, target: TARGET })

    expect(harness.toastError).toHaveBeenCalledWith(
      'failure:selected:status-unavailable:runtime-unverifiable'
    )
    expect(harness.toastDismiss).toHaveBeenCalledWith('pending-toast-id')
  })

  it('names the target agent from the resolved agent type label', async () => {
    const pane = makePane('copilot answer')
    harness.sendNotesToActiveAgentSession.mockResolvedValue({ status: 'sent' })
    const unknownAgent = { ...TARGET, agentType: null }

    await sendTerminalSelectionToAgentTarget({
      pane,
      worktreeId: WORKTREE_ID,
      target: unknownAgent
    })

    expect(harness.toastSuccess).toHaveBeenCalledWith('Sent to Agent.')
    expect(harness.track).toHaveBeenCalledWith('agent_prompt_sent', {
      agent_kind: 'other',
      launch_source: 'terminal_context_menu',
      request_kind: 'followup'
    })
  })
})
