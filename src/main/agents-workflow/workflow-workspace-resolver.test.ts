import { describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import { createAgentsWorkflowWorkspaceResolver } from './workflow-workspace-resolver'

function workflow(workspace: AgentsWorkflowDefinition['workspace']): AgentsWorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'workflow-1',
    revision: 1,
    name: 'Review',
    nodes: [],
    edges: [],
    runContext: {
      kind: 'workspace-run',
      projectId: 'project-1',
      hostId: 'local',
      projectHostSetupId: 'setup-1',
      repoId: 'repo-1',
      path: '/repo'
    },
    workspace,
    trigger: { manual: true, defaultInput: '', schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('createAgentsWorkflowWorkspaceResolver', () => {
  it('validates and returns an existing managed workspace', async () => {
    const showManagedWorktree = vi.fn(async () => ({
      id: 'workspace-1',
      displayName: 'Existing'
    }))
    const createManagedWorktree = vi.fn()
    const resolve = createAgentsWorkflowWorkspaceResolver({
      showManagedWorktree,
      createManagedWorktree
    })

    await expect(
      resolve(workflow({ mode: 'existing', workspaceId: 'workspace-1' }), 'run-1')
    ).resolves.toEqual({
      ok: true,
      workspaceId: 'workspace-1',
      displayName: 'Existing'
    })
    expect(showManagedWorktree).toHaveBeenCalledWith('id:workspace-1')
    expect(createManagedWorktree).not.toHaveBeenCalled()
  })

  it('creates an agent-first background workspace without a terminal agent', async () => {
    const createManagedWorktree = vi.fn(async (_input: object) => ({
      worktree: { id: 'workspace-2', displayName: 'Review run-1' },
      setupReceipt: { state: 'not_configured' }
    }))
    const resolve = createAgentsWorkflowWorkspaceResolver({
      showManagedWorktree: vi.fn(),
      createManagedWorktree
    })

    await expect(
      resolve(
        workflow({ mode: 'new_per_run', baseBranch: 'main', setupDecision: 'run' }),
        'run-12345678'
      )
    ).resolves.toMatchObject({ ok: true, workspaceId: 'workspace-2' })
    expect(createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        repoSelector: 'id:repo-1',
        baseBranch: 'main',
        setupDecision: 'run',
        awaitTerminalProvisioning: true,
        observeSetupCompletion: true,
        promisedAgentChat: true,
        activate: false
      })
    )
    expect(createManagedWorktree.mock.calls[0]?.[0]).not.toHaveProperty('startupAgent')
  })

  it('refuses to create a git worktree for a folder project', async () => {
    const createManagedWorktree = vi.fn()
    const resolve = createAgentsWorkflowWorkspaceResolver({
      showRepo: vi.fn(async () => ({ kind: 'folder' as const })),
      showManagedWorktree: vi.fn(),
      createManagedWorktree
    })

    await expect(
      resolve(
        workflow({ mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' }),
        'run-1'
      )
    ).resolves.toMatchObject({ ok: false, code: 'folder_workspace_requires_existing' })
    expect(createManagedWorktree).not.toHaveBeenCalled()
  })
})
