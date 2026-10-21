import { isFolderRepo } from '../../shared/repo-kind'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type { RuntimeManagedWorktreeCreateArgs } from '../runtime/runtime-managed-worktree-create-types'
import type { AgentsWorkflowWorkspaceResolver } from './workflow-run-service'

const STRUCTURED_SETUP_WAIT_TIMEOUT_MS = 60_000

type WorkflowWorkspaceRuntime = {
  showRepo?(selector: string): Promise<{ kind?: 'git' | 'folder' }>
  showManagedWorktree(selector: string): Promise<{ id: string; path: string; displayName: string }>
  waitForSetupTerminalCompletion?(handle: string, signal: AbortSignal): Promise<unknown>
  createManagedWorktree(input: RuntimeManagedWorktreeCreateArgs): Promise<{
    worktree: { id: string; path: string; displayName: string }
    setupReceipt?: { state: string }
    warning?: string
  }>
}

async function waitForStructuredSetup(
  runtime: WorkflowWorkspaceRuntime,
  receipt: { state: string; startupPolicy?: string; terminalHandle?: string } | undefined
): Promise<void> {
  if (
    !runtime.waitForSetupTerminalCompletion ||
    !receipt ||
    receipt.startupPolicy !== 'wait-for-setup' ||
    receipt.state !== 'running' ||
    !receipt.terminalHandle
  ) {
    return
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), STRUCTURED_SETUP_WAIT_TIMEOUT_MS)
  try {
    await runtime.waitForSetupTerminalCompletion(receipt.terminalHandle, abort.signal)
  } catch (error) {
    if (!abort.signal.aborted) {
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}

function failure(error: unknown) {
  return {
    ok: false as const,
    code: 'workflow_workspace_resolution_failed',
    message: error instanceof Error ? error.message : String(error)
  }
}

export function createAgentsWorkflowWorkspaceResolver(
  runtime: WorkflowWorkspaceRuntime
): AgentsWorkflowWorkspaceResolver {
  return async (workflow: AgentsWorkflowDefinition, runId: string) => {
    try {
      if (workflow.workspace.mode === 'existing') {
        const workspace = await runtime.showManagedWorktree(`id:${workflow.workspace.workspaceId}`)
        return {
          ok: true,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          displayName: workspace.displayName
        }
      }

      const repo = await runtime.showRepo?.(`id:${workflow.runContext.repoId}`)
      if (repo && isFolderRepo(repo)) {
        return {
          ok: false,
          code: 'folder_workspace_requires_existing',
          message:
            'Folder projects run in an existing workspace. Choose that workspace before running.'
        }
      }

      const created = await runtime.createManagedWorktree({
        repoSelector: `id:${workflow.runContext.repoId}`,
        name: `workflow-${runId}`,
        ...(workflow.workspace.baseBranch ? { baseBranch: workflow.workspace.baseBranch } : {}),
        displayName: `${workflow.name} ${runId.slice(0, 8)}`,
        displayNameKind: 'generated',
        runHooks: false,
        setupDecision: workflow.workspace.setupDecision,
        awaitTerminalProvisioning: true,
        observeSetupCompletion: true,
        promisedAgentChat: true,
        activate: false
      })
      if (created.setupReceipt?.state === 'spawn_failed') {
        return {
          ok: false,
          code: 'workflow_workspace_setup_failed',
          message: created.warning ?? 'Workflow workspace setup could not be started.'
        }
      }
      await waitForStructuredSetup(runtime, created.setupReceipt)
      return {
        ok: true,
        workspaceId: created.worktree.id,
        workspacePath: created.worktree.path,
        displayName: created.worktree.displayName
      }
    } catch (error) {
      return failure(error)
    }
  }
}
