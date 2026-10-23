import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowNode,
  AgentsWorkflowRunContext,
  AgentsWorkflowUpdateFields,
  AgentsWorkflowWorkspace
} from '../../../../shared/agents-workflow-types'
import { buildAutomationRunContextForRepo } from '../automations/automation-run-context'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'

export type AgentsWorkflowNewTarget = {
  runContext: AgentsWorkflowRunContext
  workspace: AgentsWorkflowWorkspace
}

type WorktreeId = { id: string }

/**
 * The target a new workflow starts on: the workspace the user is looking at, else the current
 * workflow's target, else the first project this host can actually run in.
 *
 * Why not the starter fixture's ids: those were made up, so a fresh workflow validated fine and
 * then failed its first run with `workflow_workspace_resolution_failed`.
 */
export function workflowTargetForNewWorkflow(args: {
  source: AgentsWorkflowDefinition | null
  repos: readonly Repo[]
  projectHostSetups: readonly ProjectHostSetup[]
  worktreesByRepo: Readonly<Record<string, readonly WorktreeId[]>>
  activeWorktreeId: string | null
}): AgentsWorkflowNewTarget | null {
  const runContextFor = (repoId: string): AgentsWorkflowRunContext | null =>
    buildAutomationRunContextForRepo({
      repoId,
      repos: args.repos,
      projectHostSetups: args.projectHostSetups
    })

  const repoOfActiveWorktree = args.activeWorktreeId
    ? Object.keys(args.worktreesByRepo).find((repoId) =>
        (args.worktreesByRepo[repoId] ?? []).some(
          (worktree) => worktree.id === args.activeWorktreeId
        )
      )
    : undefined
  const candidateRepoIds = [
    repoOfActiveWorktree,
    args.source?.runContext.repoId,
    ...args.repos.map((repo) => repo.id)
  ].filter((repoId): repoId is string => typeof repoId === 'string')
  const repoId = candidateRepoIds.find((candidate) => runContextFor(candidate) !== null)
  if (!repoId) {
    return null
  }
  const runContext = runContextFor(repoId)
  if (!runContext) {
    return null
  }
  const activeWorktreeId = args.activeWorktreeId
  const activeWorktreeIsInRepo =
    repoOfActiveWorktree === repoId &&
    activeWorktreeId !== null &&
    (args.worktreesByRepo[repoId] ?? []).some((worktree) => worktree.id === activeWorktreeId)
  const sourceWorkspace = args.source?.workspace
  const reusesSourceWorkspace =
    !activeWorktreeIsInRepo &&
    sourceWorkspace?.mode === 'existing' &&
    args.source?.runContext.repoId === repoId &&
    (args.worktreesByRepo[repoId] ?? []).some(
      (worktree) => worktree.id === sourceWorkspace.workspaceId
    )
  return {
    runContext,
    workspace:
      activeWorktreeIsInRepo && activeWorktreeId !== null
        ? { mode: 'existing', workspaceId: activeWorktreeId }
        : reusesSourceWorkspace && sourceWorkspace
          ? sourceWorkspace
          : {
              mode: 'new_per_run',
              baseBranch:
                sourceWorkspace?.mode === 'new_per_run' ? sourceWorkspace.baseBranch : null,
              setupDecision:
                sourceWorkspace?.mode === 'new_per_run' ? sourceWorkspace.setupDecision : 'inherit'
            }
  }
}

/** A blank graph: the canvas cannot create start or end nodes, so a new workflow starts with them. */
function blankWorkflowNodes(): AgentsWorkflowNode[] {
  return [
    { id: 'start', kind: 'start', title: 'Start', position: { x: 80, y: 180 } },
    { id: 'end', kind: 'end', title: 'End', position: { x: 340, y: 180 } }
  ]
}

/**
 * The input a new workflow is created from. Only the target and triggers carry over from `source`;
 * the graph always starts blank so a new workflow is not a copy of the one the user was viewing.
 */
export function newWorkflowInput(
  source: AgentsWorkflowDefinition | null,
  target?: AgentsWorkflowNewTarget
): AgentsWorkflowCreateInput {
  const template = source ?? createAgentsWorkflowPageFixture()
  const {
    id: _id,
    revision: _revision,
    schedulerOwner: _schedulerOwner,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    nodes: _nodes,
    edges: _edges,
    ...input
  } = template
  return {
    ...input,
    ...(target
      ? {
          runContext: target.runContext,
          workspace: target.workspace
        }
      : {}),
    creationKey: createBrowserUuid(),
    name: translate('auto.components.agents-workflow.controller.newName', 'New workflow'),
    nodes: blankWorkflowNodes(),
    edges: [],
    trigger: { ...input.trigger, schedule: null }
  }
}

export function workflowUpdateFields(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowUpdateFields {
  return {
    schemaVersion: definition.schemaVersion,
    name: definition.name,
    nodes: definition.nodes,
    edges: definition.edges,
    runContext: definition.runContext,
    workspace: definition.workspace,
    trigger: definition.trigger,
    enabled: definition.enabled
  }
}
