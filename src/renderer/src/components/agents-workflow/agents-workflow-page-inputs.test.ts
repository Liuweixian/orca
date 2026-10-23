import { describe, expect, it, vi } from 'vitest'
import type { ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import { newWorkflowInput, workflowTargetForNewWorkflow } from './agents-workflow-page-inputs'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => 'creation-key'
}))

function repo(id: string): Repo {
  return {
    id,
    path: `/repo/${id}`,
    displayName: id,
    kind: 'git',
    executionHostId: 'local'
  } as unknown as Repo
}

function setup(repoId: string): ProjectHostSetup {
  return {
    id: `setup-${repoId}`,
    projectId: `project-${repoId}`,
    hostId: 'local',
    repoId,
    path: `/repo/${repoId}`,
    setupState: 'ready'
  } as unknown as ProjectHostSetup
}

describe('workflowTargetForNewWorkflow', () => {
  it('starts a new workflow on the workspace the user is looking at', () => {
    const target = workflowTargetForNewWorkflow({
      source: null,
      repos: [repo('repo-1')],
      projectHostSetups: [setup('repo-1')],
      worktreesByRepo: { 'repo-1': [{ id: 'workspace-1' }] },
      activeWorktreeId: 'workspace-1'
    })

    expect(target).toEqual({
      runContext: expect.objectContaining({ repoId: 'repo-1', projectId: 'project-repo-1' }),
      workspace: { mode: 'existing', workspaceId: 'workspace-1' }
    })
  })

  it('never keeps the starter fixture ids', () => {
    const source = createAgentsWorkflowPageFixture(1)
    const target = workflowTargetForNewWorkflow({
      source,
      repos: [repo('repo-1')],
      projectHostSetups: [setup('repo-1')],
      worktreesByRepo: {},
      activeWorktreeId: null
    })

    expect(target?.runContext.repoId).toBe('repo-1')
    expect(target?.workspace).toEqual({
      mode: 'new_per_run',
      baseBranch: null,
      setupDecision: 'inherit'
    })
    // The input is what the store receives, so the fake ids must not survive into it.
    const input = newWorkflowInput(source, target ?? undefined)
    expect(input).toMatchObject({
      runContext: { repoId: 'repo-1' },
      workspace: { mode: 'new_per_run' },
      creationKey: 'creation-key'
    })
    // Why: a new workflow starts blank instead of copying the one the user was viewing, but the
    // canvas cannot create start or end nodes, so those two must come from the input.
    expect(input.nodes.map((node) => node.kind)).toEqual(['start', 'end'])
    expect(input.edges).toEqual([])
  })

  it('refuses to invent a target when no project can run on this host', () => {
    expect(
      workflowTargetForNewWorkflow({
        source: null,
        repos: [repo('repo-1')],
        projectHostSetups: [],
        worktreesByRepo: {},
        activeWorktreeId: null
      })
    ).toBeNull()
  })
})
