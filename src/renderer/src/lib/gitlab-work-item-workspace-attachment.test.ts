import { describe, expect, it } from 'vitest'

import { findGitLabMrWorkspaceAttachment } from './gitlab-work-item-workspace-attachment'
import type { Worktree } from '../../../shared/worktree/types'

const MR_URL = 'https://gitlab.com/stably/orca/-/merge_requests/87'

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

describe('findGitLabMrWorkspaceAttachment', () => {
  it('finds the workspace attached to the merge request', () => {
    const attached = worktree({
      id: 'wt-mr',
      linkedItems: [{ provider: 'gitlab', type: 'mr', number: 87, url: MR_URL }]
    })

    expect(findGitLabMrWorkspaceAttachment([worktree(), attached], 'repo-1', 87, MR_URL)?.id).toBe(
      'wt-mr'
    )
  })

  it('ignores a same-numbered merge request from another project', () => {
    const otherProject = worktree({
      id: 'wt-other-project',
      linkedItems: [
        {
          provider: 'gitlab',
          type: 'mr',
          number: 87,
          url: 'https://gitlab.com/stably/other/-/merge_requests/87'
        }
      ]
    })

    expect(findGitLabMrWorkspaceAttachment([otherProject], 'repo-1', 87, MR_URL)).toBeNull()
  })

  it('falls back to a number match when the attachment carries no URL', () => {
    const attached = worktree({
      id: 'wt-mr',
      linkedItems: [{ provider: 'gitlab', type: 'mr', number: 87 }]
    })

    expect(findGitLabMrWorkspaceAttachment([attached], 'repo-1', 87)?.id).toBe('wt-mr')
  })

  it('does not match issues, archived workspaces, or other repositories', () => {
    const issue = worktree({
      id: 'wt-issue',
      linkedItems: [{ provider: 'gitlab', type: 'issue', number: 87, url: MR_URL }]
    })
    const archived = worktree({
      id: 'wt-archived',
      isArchived: true,
      linkedItems: [{ provider: 'gitlab', type: 'mr', number: 87, url: MR_URL }]
    })
    const foreign = worktree({
      id: 'wt-foreign',
      repoId: 'repo-2',
      linkedItems: [{ provider: 'gitlab', type: 'mr', number: 87 }]
    })

    expect(findGitLabMrWorkspaceAttachment([issue, archived, foreign], 'repo-1', 87)).toBeNull()
  })

  it('returns null without a repository id', () => {
    expect(findGitLabMrWorkspaceAttachment([worktree()], null, 87, MR_URL)).toBeNull()
  })
})
