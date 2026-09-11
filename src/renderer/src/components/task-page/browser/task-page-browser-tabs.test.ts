import { describe, expect, it } from 'vitest'

import {
  appendTaskPageBrowserTab,
  createTaskPageBrowserTabId,
  getTaskPageBrowserTabLabel,
  readTaskPageBrowserTabs,
  removeTaskPageBrowserTab,
  updateTaskPageBrowserTabUrl
} from './task-page-browser-tabs'

describe('readTaskPageBrowserTabs', () => {
  it('returns the persisted list unchanged', () => {
    const tabs = [{ id: 'a', url: 'https://a.example.com' }]
    expect(readTaskPageBrowserTabs({ taskPageBrowserTabs: tabs })).toEqual(tabs)
  })

  it('defaults to empty for missing or malformed values', () => {
    expect(readTaskPageBrowserTabs(null)).toEqual([])
    expect(readTaskPageBrowserTabs({})).toEqual([])
    expect(readTaskPageBrowserTabs({ taskPageBrowserTabs: 'nope' })).toEqual([])
  })

  it('drops malformed entries', () => {
    expect(
      readTaskPageBrowserTabs({
        taskPageBrowserTabs: [
          { id: 'a', url: 'https://a.example.com' },
          { id: '', url: 'https://b.example.com' },
          { id: 'c' },
          null
        ]
      })
    ).toEqual([{ id: 'a', url: 'https://a.example.com' }])
  })
})

describe('tab list operations', () => {
  const tabs = [
    { id: 'a', url: 'https://a.example.com' },
    { id: 'b', url: 'https://b.example.com' }
  ]

  it('appends a tab at the end without mutating the input', () => {
    const appended = appendTaskPageBrowserTab(tabs, { id: 'c', url: 'https://c.example.com' })
    expect(appended).toHaveLength(3)
    expect(appended[2]).toEqual({ id: 'c', url: 'https://c.example.com' })
    expect(tabs).toHaveLength(2)
  })

  it('updates only the matching tab url', () => {
    expect(updateTaskPageBrowserTabUrl(tabs, 'b', 'https://new.example.com')).toEqual([
      { id: 'a', url: 'https://a.example.com' },
      { id: 'b', url: 'https://new.example.com' }
    ])
  })

  it('removes only the matching tab', () => {
    expect(removeTaskPageBrowserTab(tabs, 'a')).toEqual([{ id: 'b', url: 'https://b.example.com' }])
    expect(removeTaskPageBrowserTab(tabs, 'missing')).toEqual(tabs)
  })
})

describe('createTaskPageBrowserTabId', () => {
  it('creates non-empty unique ids', () => {
    const first = createTaskPageBrowserTabId()
    const second = createTaskPageBrowserTabId()
    expect(first).not.toBe('')
    expect(second).not.toBe('')
    expect(first).not.toBe(second)
  })
})

describe('getTaskPageBrowserTabLabel', () => {
  it('uses the hostname', () => {
    expect(getTaskPageBrowserTabLabel('https://linear.app/team/inbox')).toBe('linear.app')
  })

  it('falls back to the raw url when there is no hostname', () => {
    expect(getTaskPageBrowserTabLabel('file:///tmp/report.html')).toBe('file:///tmp/report.html')
    expect(getTaskPageBrowserTabLabel('not a url')).toBe('not a url')
  })
})
