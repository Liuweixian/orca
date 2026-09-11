import { describe, expect, it } from 'vitest'

import { resolveTaskPageBrowserUrl } from './task-page-browser-url'

describe('resolveTaskPageBrowserUrl', () => {
  it('accepts http and https URLs unchanged', () => {
    expect(resolveTaskPageBrowserUrl('https://linear.app/team/inbox')).toBe(
      'https://linear.app/team/inbox'
    )
    expect(resolveTaskPageBrowserUrl('http://localhost:3000/board')).toBe(
      'http://localhost:3000/board'
    )
  })

  it('upgrades a scheme-less domain to https', () => {
    expect(resolveTaskPageBrowserUrl('example.com/todos')).toBe('https://example.com/todos')
  })

  it('rejects blank input', () => {
    expect(resolveTaskPageBrowserUrl('')).toBeNull()
    expect(resolveTaskPageBrowserUrl('   ')).toBeNull()
    expect(resolveTaskPageBrowserUrl('about:blank')).toBeNull()
  })

  it('rejects non-navigable schemes', () => {
    expect(resolveTaskPageBrowserUrl('javascript:alert(1)')).toBeNull()
    expect(resolveTaskPageBrowserUrl('not a url')).toBeNull()
  })
})
