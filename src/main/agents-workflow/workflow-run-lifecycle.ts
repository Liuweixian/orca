// The bookkeeping that ends a workflow run, kept apart from scheduling it.
//
// A run must always leave `running`, whether the engine returned a failure, threw, or never found a
// workspace. These helpers are the single place that settles the run and drops its answer folder.

import { rm, rmdir } from 'node:fs/promises'
import type { AgentsWorkflowRun } from '../../shared/agents-workflow-run-types'
import {
  agentsWorkflowRunAnswersDirectory,
  agentsWorkflowRunDirectory
} from '../../shared/agents-workflow-output-paths'

type FinishPersistence = {
  updateAgentsWorkflowRun(runId: string, updates: Partial<AgentsWorkflowRun>): AgentsWorkflowRun
  flushPendingOrThrowAsync?: (options?: { drainToStableGeneration?: boolean }) => Promise<void>
}

export type RecoveryPersistence = FinishPersistence & {
  markInterruptedAgentsWorkflowRunsUnverifiable(now: number): AgentsWorkflowRun[]
}

export type AgentsWorkflowRunLifecycle = {
  persistence: FinishPersistence
  notifyChanged: () => void
  now: () => number
}

export function isActiveAgentsWorkflowRun(run: AgentsWorkflowRun): boolean {
  return run.status === 'pending' || run.status === 'running' || run.status === 'cancel_requested'
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
  // A crash leaves the run's answer folder behind; the interrupted run is the one that owns it.
  for (const run of recovered) {
    await removeAgentsWorkflowRunAnswers(run.definitionSnapshot.runContext.path, run.id)
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

/** Drops the engine's answer cache; a file an agent delivered is kept. */
export async function removeAgentsWorkflowRunAnswers(
  workspacePath: string,
  runId: string
): Promise<void> {
  try {
    await rm(agentsWorkflowRunAnswersDirectory(workspacePath, runId), {
      recursive: true,
      force: true
    })
    // Non-recursive on purpose: a run folder still holding a delivered file is kept.
    await rmdir(agentsWorkflowRunDirectory(workspacePath, runId))
  } catch {
    // Scratch cleanup never fails a finished run.
  }
}

export const failClosedAgentsWorkflowWorkspaceResolver = async () => {
  return {
    ok: false as const,
    code: 'workflow_workspace_adapter_unavailable',
    message: 'The workflow workspace launch adapter is unavailable on this build.'
  }
}
