import { describe, expect, it } from 'vitest'

import { resolvePrReviewWorktreeId } from './pr-review-agent-launch'
import type { Worktree } from '../../../shared/worktree/types'

const PR_URL = 'https://github.com/stablyai/orca/pull/42'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: overrides.id ?? 'wt-1',
    repoId: overrides.repoId ?? 'repo-1',
    path: overrides.path ?? '/tmp/repo-1/wt-1',
    head: 'abc123',
    branch: overrides.branch ?? 'refs/heads/feature/review',
    isBare: false,
    isMainWorktree: overrides.isMainWorktree ?? false,
    displayName: overrides.displayName ?? 'workspace',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

describe('resolvePrReviewWorktreeId', () => {
  it('prefers the workspace attached to the pull request', () => {
    const attached = worktree({ id: 'wt-pr', linkedPR: 42 })
    const main = worktree({ id: 'wt-main', isMainWorktree: true })

    expect(resolvePrReviewWorktreeId([main, attached], 'repo-1', { number: 42, url: PR_URL })).toBe(
      'wt-pr'
    )
  })

  it('falls back to the repository main checkout', () => {
    const main = worktree({ id: 'wt-main', isMainWorktree: true })
    const other = worktree({ id: 'wt-other', linkedPR: 7 })

    expect(resolvePrReviewWorktreeId([other, main], 'repo-1', { number: 42, url: PR_URL })).toBe(
      'wt-main'
    )
  })

  it('uses any remaining checkout when the main one is missing', () => {
    const other = worktree({ id: 'wt-other' })

    expect(resolvePrReviewWorktreeId([other], 'repo-1', { number: 42, url: PR_URL })).toBe(
      'wt-other'
    )
  })

  it('returns null when the repository has no usable workspace', () => {
    expect(
      resolvePrReviewWorktreeId(
        [
          worktree({ id: 'other-repo', repoId: 'repo-2' }),
          worktree({ id: 'archived', isArchived: true })
        ],
        'repo-1',
        { number: 42, url: PR_URL }
      )
    ).toBeNull()
  })
})
