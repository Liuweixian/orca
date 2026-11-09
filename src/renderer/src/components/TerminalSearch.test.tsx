// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SearchAddon } from '@xterm/addon-search'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalSearch from './TerminalSearch'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

type ResultsEvent = { resultIndex: number; resultCount: number }

function createSearchAddon() {
  let listener: ((payload: ResultsEvent) => void) | null = null
  const dispose = vi.fn(() => {
    listener = null
  })
  const stub = {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn(),
    onDidChangeResults: (handler: (payload: ResultsEvent) => void) => {
      listener = handler
      return { dispose }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The stub implements every addon member used by TerminalSearch.
  const addon = stub as unknown as SearchAddon
  return {
    addon,
    dispose,
    emit: (payload: ResultsEvent) => act(() => listener?.(payload))
  }
}

function renderSearch(searchAddon: SearchAddon, query = ''): ReturnType<typeof render> {
  const view = render(
    <TerminalSearch
      isOpen
      onClose={vi.fn()}
      searchAddon={searchAddon}
      searchStateRef={{ current: { query: '', caseSensitive: false, regex: false } }}
    />
  )
  if (query) {
    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: query } })
  }
  return view
}

describe('TerminalSearch cleanup', () => {
  it('clears and unsubscribes the previous addon when search moves to another pane', async () => {
    const previous = createSearchAddon()
    const next = createSearchAddon()
    const view = renderSearch(previous.addon, 'needle')
    previous.emit({ resultIndex: 1, resultCount: 3 })
    await waitFor(() => expect(previous.addon.findNext).toHaveBeenCalled())
    vi.mocked(previous.addon.clearDecorations).mockClear()
    vi.mocked(previous.addon.findNext).mockClear()

    view.rerender(
      <TerminalSearch
        isOpen
        onClose={vi.fn()}
        searchAddon={next.addon}
        searchStateRef={{ current: { query: '', caseSensitive: false, regex: false } }}
      />
    )

    expect(previous.addon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(previous.addon.findNext).toHaveBeenCalledWith('')
    expect(previous.dispose).toHaveBeenCalledTimes(1)
    next.emit({ resultIndex: 0, resultCount: 7 })
    previous.emit({ resultIndex: 2, resultCount: 3 })
    expect(view.getByText('1/7')).toBeTruthy()
  })
})

describe('TerminalSearch stale query', () => {
  it('clears the previous query when the overlay reopens', () => {
    const { addon } = createSearchAddon()
    const searchStateRef = { current: { query: '', caseSensitive: false, regex: false } }
    const baseProps = { onClose: vi.fn(), searchAddon: addon, searchStateRef }
    const view = render(<TerminalSearch {...baseProps} isOpen />)

    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    expect(addon.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true })
    )

    view.rerender(<TerminalSearch {...baseProps} isOpen={false} />)
    view.rerender(<TerminalSearch {...baseProps} isOpen />)

    expect(view.getByPlaceholderText('Search...')).toHaveValue('')
    expect(searchStateRef.current.query).toBe('')
    // Why: the stale query must never drive a second find session after reopening.
    expect(vi.mocked(addon.findNext).mock.calls.filter(([term]) => term === 'needle')).toHaveLength(
      1
    )
  })
})
