import { describe, expect, it } from 'vitest'
import { normalizeRightSidebarTab } from './ui-selection-normalization'

describe('normalizeRightSidebarTab — Workflows tab', () => {
  it('preserves the Workflows tab across a reload', () => {
    expect(normalizeRightSidebarTab('workflows')).toBe('workflows')
  })
})
