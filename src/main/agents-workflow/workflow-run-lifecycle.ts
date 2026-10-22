// The bookkeeping that ends a workflow run, kept apart from scheduling it.
//
// A run must always leave `running`, whether the engine returned a failure, threw, or never found a
// workspace. These helpers are the single place that settles the run and drops its scratch folder.

import { rm } from 'node:fs/promises'
import type { AgentsWorkflowRun } from '../../shared/agents-workflow-run-types'
import { agentsWorkflowRunDirectory } from '../../shared/agents-workflow-output-paths'

type FinishPersistence = {
  updateAgentsWorkflowRun(runId: string, updates: Partial<AgentsWorkflowRun>): AgentsWorkflowRun
  flushPendingOrThrowAsync?: (options?: { drainToStableGeneration?: boolean }) => Promise<void>
}

export type RecoveryPersistence = FinishPersistence & {
  markInterruptedAgentsWorkflowRunsUnverifiable(now: number): AgentsWorkflowRun[]
}

/** Resolves where a run was actually writing, from the workspace it ran in. */
export type AgentsWorkflowWorkspacePathResolver = (workspaceId: string) => Promise<string | null>

export type AgentsWorkflowRunLifecycle = {
  persistence: FinishPersistence
  notifyChanged: () => void
  now: () => number
  /** Absent when the host cannot map a workspace id back to a path. */
  resolveWorkspacePath?: AgentsWorkflowWorkspacePathResolver
}

export async function flushAgentsWorkflowPersistence(
  persistence: FinishPersistence
): Promise<void> {
  await persistence.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
}

/** Marks runs a crash left active as unverifiable, once per process. */
export async function recoverInterruptedAgentsWorkflowRuns(
  lifecycle: AgentsWorkflowRunLifecycle & { persistence: RecoveryPersistence }
): Promise<void> {
  const recovered = lifecycle.persistence.markInterruptedAgentsWorkflowRunsUnverifiable(
    lifecycle.now()
  )
  if (recovered.length === 0) {
    return
  }
  // A crash leaves the run's scratch folder behind. Why the workspace id and not the definition's
  // project path: a `new_per_run` run wrote it inside the worktree it created, not the project.
  for (const run of recovered) {
    const workspacePath = await resolveRunWorkspacePath(lifecycle, run)
    if (workspacePath !== null) {
      await removeAgentsWorkflowRunScratch(workspacePath, run.id)
    }
  }
  await flushAgentsWorkflowPersistence(lifecycle.persistence)
  lifecycle.notifyChanged()
}

export async function finishAgentsWorkflowRun(
  lifecycle: AgentsWorkflowRunLifecycle,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled' | 'unverifiable',
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  lifecycle.persistence.updateAgentsWorkflowRun(runId, {
    status,
    finishedAt: lifecycle.now(),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  })
  await flushAgentsWorkflowPersistence(lifecycle.persistence)
  lifecycle.notifyChanged()
}

/**
 * Settles a run the user asked to stop. The stop's own verdict decides the status: a host that
 * cannot confirm the stop is an `unverifiable` ending, not a quieter `cancelled`.
 */
export async function finishCancelledAgentsWorkflowRun(
  lifecycle: AgentsWorkflowRunLifecycle,
  run: AgentsWorkflowRun,
  stopped: 'stopped' | 'unverifiable'
): Promise<AgentsWorkflowRun> {
  const status = stopped === 'stopped' ? 'cancelled' : 'unverifiable'
  const finishedAt = lifecycle.now()
  const updated = lifecycle.persistence.updateAgentsWorkflowRun(run.id, {
    status,
    finishedAt,
    attempts: run.attempts.map((attempt) =>
      attempt.status === 'running' || attempt.status === 'pending'
        ? { ...attempt, status, finishedAt }
        : attempt
    ),
    ...(status === 'unverifiable'
      ? {
          errorCode: 'cancellation_unverifiable',
          errorMessage: 'The agent stop request could not be confirmed.'
        }
      : {})
  })
  await flushAgentsWorkflowPersistence(lifecycle.persistence)
  lifecycle.notifyChanged()
  return updated
}

/** Removes a worktree a run created; a later mixin owns the actual checkout. */
export type AgentsWorkflowRunWorkspaceReclaimer = (workspaceId: string) => Promise<void>

/**
 * Drops the run's scratch folder, including the files agents left for the next node. The answers
 * live on in run history, and the folder is git-ignored while the run is in flight.
 */
export async function removeAgentsWorkflowRunScratch(
  workspacePath: string,
  runId: string
): Promise<void> {
  try {
    await rm(agentsWorkflowRunDirectory(workspacePath, runId), { recursive: true, force: true })
  } catch {
    // Scratch cleanup never fails a finished run.
  }
}

/**
 * A scheduled run in a `new_per_run` workspace takes its checkout with it: nobody is watching it,
 * and leaving one per occurrence would grow the repo's workspace list forever. A manual run keeps
 * its checkout for the user.
 */
export async function reclaimScheduledRunWorkspace(
  reclaim: AgentsWorkflowRunWorkspaceReclaimer | undefined,
  run: AgentsWorkflowRun,
  workspaceId: string | null
): Promise<void> {
  if (
    !reclaim ||
    workspaceId === null ||
    run.trigger !== 'schedule' ||
    run.definitionSnapshot.workspace.mode !== 'new_per_run'
  ) {
    return
  }
  try {
    await reclaim(workspaceId)
  } catch (error) {
    // A checkout that cannot be removed now must not turn a finished run into a failure.
    console.error('[agents-workflow] Run workspace cleanup failed:', error)
  }
}

async function resolveRunWorkspacePath(
  lifecycle: AgentsWorkflowRunLifecycle,
  run: AgentsWorkflowRun
): Promise<string | null> {
  if (!run.workspaceId || !lifecycle.resolveWorkspacePath) {
    return null
  }
  try {
    return await lifecycle.resolveWorkspacePath(run.workspaceId)
  } catch {
    // A workspace that is already gone has nothing left to clean.
    return null
  }
}

export const failClosedAgentsWorkflowWorkspaceResolver = async () => {
  return {
    ok: false as const,
    code: 'workflow_workspace_adapter_unavailable',
    message: 'The workflow workspace launch adapter is unavailable on this build.'
  }
}
