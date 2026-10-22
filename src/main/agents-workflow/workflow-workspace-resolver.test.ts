import { describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type { RuntimeManagedWorktreeCreateArgs } from '../runtime/runtime-managed-worktree-create-types'
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
    trigger: { manual: true, schedule: null },
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
      path: '/repo/workspace-1',
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
      workspacePath: '/repo/workspace-1',
      displayName: 'Existing'
    })
    expect(showManagedWorktree).toHaveBeenCalledWith('id:workspace-1')
    expect(createManagedWorktree).not.toHaveBeenCalled()
  })

  it('creates an agent-first background workspace without a terminal agent', async () => {
    const createManagedWorktree = vi.fn(async (_input: RuntimeManagedWorktreeCreateArgs) => ({
      worktree: { id: 'workspace-2', path: '/repo/workspace-2', displayName: 'Review run-1' },
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

  it('does not wait out the setup window of a cancelled run', async () => {
    const controller = new AbortController()
    const waitForSetupTerminalCompletion = vi.fn(
      (_handle: string, signal: AbortSignal) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    )
    const createManagedWorktree = vi.fn(async (_input: RuntimeManagedWorktreeCreateArgs) => {
      // The run is cancelled while its workspace is being provisioned.
      controller.abort()
      return {
        worktree: { id: 'workspace-2', path: '/repo/workspace-2', displayName: 'Review run-1' },
        setupReceipt: { state: 'running', startupPolicy: 'wait-for-setup', terminalHandle: 'h-1' }
      }
    })
    const resolve = createAgentsWorkflowWorkspaceResolver({
      showManagedWorktree: vi.fn(),
      createManagedWorktree,
      waitForSetupTerminalCompletion
    })

    await expect(
      resolve(
        workflow({ mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' }),
        'run-1',
        {
          signal: controller.signal
        }
      )
    ).resolves.toMatchObject({ ok: true, workspaceId: 'workspace-2' })
    expect(waitForSetupTerminalCompletion).not.toHaveBeenCalled()
  })

  it('refuses immediately when the run was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const createManagedWorktree = vi.fn()
    const resolve = createAgentsWorkflowWorkspaceResolver({
      showManagedWorktree: vi.fn(),
      createManagedWorktree
    })

    await expect(
      resolve(
        workflow({ mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' }),
        'run-1',
        {
          signal: controller.signal
        }
      )
    ).resolves.toMatchObject({ ok: false, code: 'workflow_run_cancelled' })
    expect(createManagedWorktree).not.toHaveBeenCalled()
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
