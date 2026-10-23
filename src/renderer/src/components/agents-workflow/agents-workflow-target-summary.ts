import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId
} from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { translate } from '@/i18n/i18n'

export type AgentsWorkflowTargetLabels = {
  host: string
  project: string
  workspace: string
}

/** Display labels for the workflow's stored run target, not live workspace state. */
export function describeAgentsWorkflowTarget(
  definition: AgentsWorkflowDefinition,
  repos: readonly Repo[],
  worktreesByRepo: Record<string, readonly Worktree[]>
): AgentsWorkflowTargetLabels {
  const { runContext, workspace } = definition
  const project = repos.find((repo) => repo.id === runContext.repoId)
  const worktree =
    workspace.mode === 'existing'
      ? worktreesByRepo[runContext.repoId]?.find((entry) => entry.id === workspace.workspaceId)
      : null
  return {
    host: getExecutionHostLabel(
      normalizeExecutionHostId(runContext.hostId) ?? LOCAL_EXECUTION_HOST_ID
    ),
    project: project?.displayName ?? runContext.projectId,
    // Why the branch for a new run: that run starts on a branch that does not exist yet, so the
    // meaningful detail is where it branches from.
    workspace:
      workspace.mode === 'existing'
        ? (worktree?.displayName ?? workspace.workspaceId)
        : translate(
            'auto.components.agents-workflow.target.newBranchFrom',
            'New branch from {{value0}}',
            {
              value0:
                workspace.baseBranch ??
                translate('auto.components.agents-workflow.target.defaultBranch', 'default branch')
            }
          )
  }
}
