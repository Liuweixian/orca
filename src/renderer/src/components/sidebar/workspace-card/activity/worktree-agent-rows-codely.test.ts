import { describe, expect, it } from 'vitest'
import type {
  TerminalLayoutSnapshot,
  TerminalTab
} from '../../../../../../shared/workspace-layout/terminal-tab-types'
import { buildWorktreeAgentRows } from './worktree-agent-rows'

const LEAF_ID_1 = '77777777-7777-4777-8777-777777777777'

function makeTab(id: string, overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id,
    worktreeId: 'wt-1',
    ptyId: null,
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function makeSingleLayout(leafId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null
  }
}

describe('buildWorktreeAgentRows — Codely titles', () => {
  it('adds a Codely row from its base title even while the agent is responding', () => {
    // Why: Codely keeps one base title for idle AND responding, so presence — not
    // state — is what the title can prove; surfacing the row is the point.
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: { 'tab-1': { 1: 'Codely - orca' } },
      ptyIdsByTabId: { 'tab-1': ['pty-codely'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.prompt])).toEqual([
      ['codely', 'idle', 'Codely']
    ])
  })

  it('marks a waiting-confirmation Codely title as a permission row', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: { 'tab-1': { 1: '\u23f8\ufe0f Codely - orca' } },
      ptyIdsByTabId: { 'tab-1': ['pty-codely'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state])).toEqual([['codely', 'waiting']])
  })
})
