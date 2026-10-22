import { isFolderRepo } from '../../shared/repo-kind'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type { RuntimeManagedWorktreeCreateArgs } from '../runtime/runtime-managed-worktree-create-types'

export type AgentsWorkflowWorkspaceResolver = (
  workflow: AgentsWorkflowDefinition,
  runId: string,
  /** The run's own signal: a cancelled run must stop waiting on setup, not build a checkout. */
  options?: { signal?: AbortSignal }
) => Promise<
  | { ok: true; workspaceId: string; workspacePath: string; displayName: string }
  | { ok: false; code: string; message: string }
>

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
  receipt: { state: string; startupPolicy?: string; terminalHandle?: string } | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (
    !runtime.waitForSetupTerminalCompletion ||
    !receipt ||
    receipt.startupPolicy !== 'wait-for-setup' ||
    receipt.state !== 'running' ||
    !receipt.terminalHandle ||
    signal?.aborted
  ) {
    return
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), STRUCTURED_SETUP_WAIT_TIMEOUT_MS)
  // Why linked: a cancelled run kept waiting out the full setup window and then created a
  // checkout nobody would use.
  const abortOnRun = (): void => abort.abort()
  signal?.addEventListener('abort', abortOnRun)
  try {
    await runtime.waitForSetupTerminalCompletion(receipt.terminalHandle, abort.signal)
  } catch (error) {
    if (!abort.signal.aborted) {
      throw error
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortOnRun)
  }
}

function failure(error: unknown) {
  return {
    ok: false as const,
    code: 'workflow_workspace_resolution_failed',
    message: error instanceof Error ? error.message : String(error)
  }
}

function cancelled() {
  return {
    ok: false as const,
    code: 'workflow_run_cancelled',
    message: 'The run was cancelled before its workspace was ready.'
  }
}

export function createAgentsWorkflowWorkspaceResolver(
  runtime: WorkflowWorkspaceRuntime
): AgentsWorkflowWorkspaceResolver {
  return async (workflow: AgentsWorkflowDefinition, runId: string, options) => {
    const signal = options?.signal
    try {
      if (signal?.aborted) {
        return cancelled()
      }
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
      await waitForStructuredSetup(runtime, created.setupReceipt, signal)
      // Why report the workspace even when cancelled: it exists, and the run's cleanup is the
      // layer that knows whether to reclaim it.
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
