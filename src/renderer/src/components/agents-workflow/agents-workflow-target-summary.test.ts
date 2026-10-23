import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import { describeAgentsWorkflowTarget } from './agents-workflow-target-summary'

const repos: readonly Repo[] = [
  {
    id: 'fixture-repo',
    path: '/repos/fixture-repo',
    displayName: 'Fixture project',
    badgeColor: '#000000',
    addedAt: 0
  }
]

const worktreesByRepo: Record<string, readonly Worktree[]> = {
  'fixture-repo': [
    {
      id: 'wt-1',
      repoId: 'fixture-repo',
      path: '/repos/fixture-repo/wt-1',
      head: 'abc123',
      branch: 'refs/heads/release-notes',
      isBare: false,
      isMainWorktree: false,
      displayName: 'release-notes',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      linkedGitLabMR: null,
      linkedGitLabIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    }
  ]
}

describe('describeAgentsWorkflowTarget', () => {
  it('names the bound worktree rather than its id', () => {
    const definition = createAgentsWorkflowPageFixture()
    definition.workspace = { mode: 'existing', workspaceId: 'wt-1' }

    expect(describeAgentsWorkflowTarget(definition, repos, worktreesByRepo).workspace).toBe(
      'release-notes'
    )
  })

  it('falls back to the workspace id when the worktree is no longer known', () => {
    const definition = createAgentsWorkflowPageFixture()
    definition.workspace = { mode: 'existing', workspaceId: 'wt-gone' }

    expect(describeAgentsWorkflowTarget(definition, repos, worktreesByRepo).workspace).toBe(
      'wt-gone'
    )
  })

  it('names the base branch a new-per-run workflow branches from', () => {
    const definition = createAgentsWorkflowPageFixture()
    definition.workspace = { mode: 'new_per_run', baseBranch: 'main', setupDecision: 'inherit' }

    expect(describeAgentsWorkflowTarget(definition, repos, worktreesByRepo).workspace).toBe(
      'New branch from main'
    )
  })

  it('falls back to the default branch when no base branch is set', () => {
    const definition = createAgentsWorkflowPageFixture()
    definition.workspace = { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' }

    expect(describeAgentsWorkflowTarget(definition, repos, worktreesByRepo).workspace).toBe(
      'New branch from default branch'
    )
  })
})
