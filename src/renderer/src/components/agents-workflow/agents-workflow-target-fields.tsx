import React from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CreateFromPicker } from '@/components/repo/CreateFromPicker'
import { useAppStore } from '@/store'
import { useRepoMap } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import {
  getExecutionHostLabel,
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import { buildWorkspaceRunContext } from '../../../../shared/task-source-context'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowRunContext,
  AgentsWorkflowWorkspace
} from '../../../../shared/agents-workflow-types'
import type { ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import AutomationProjectCombobox from '../automations/AutomationProjectCombobox'
import { WorkspaceCombobox } from '../automations/WorkspaceCombobox'

export function AgentsWorkflowTargetFields({
  definition,
  onChange
}: {
  definition: AgentsWorkflowDefinition
  onChange: (definition: AgentsWorkflowDefinition) => void
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const repoMap = useRepoMap()

  const hostId = definition.runContext.hostId
  const hostIds = React.useMemo(() => {
    const ids = new Set<string>([hostId])
    for (const repo of repos) {
      ids.add(getRepoExecutionHostId(repo))
    }
    return [...ids].sort((left, right) =>
      workflowHostLabel(left, sshTargetLabels).localeCompare(
        workflowHostLabel(right, sshTargetLabels)
      )
    )
  }, [hostId, repos, sshTargetLabels])
  const hostRepos = React.useMemo(
    () => repos.filter((repo) => getRepoExecutionHostId(repo) === hostId),
    [hostId, repos]
  )
  const repo = repos.find((candidate) => candidate.id === definition.runContext.repoId) ?? null
  const worktrees = worktreesByRepo[definition.runContext.repoId] ?? []

  const applyRepo = (nextRepo: Repo, nextHostId: string): void => {
    const runContext = resolveRunContext(nextRepo, nextHostId, projectHostSetups)
    if (!runContext) {
      return
    }
    onChange({
      ...definition,
      runContext,
      workspace: resetWorkspaceForRepo(definition.workspace),
      updatedAt: Date.now()
    })
  }

  const onHostChange = (nextHostId: string): void => {
    const onHost = repos.filter((candidate) => getRepoExecutionHostId(candidate) === nextHostId)
    const nextRepo =
      onHost.find((candidate) => candidate.id === definition.runContext.repoId) ?? onHost[0]
    if (nextRepo) {
      applyRepo(nextRepo, nextHostId)
    }
  }

  const onWorkspaceChange = (workspace: AgentsWorkflowWorkspace): void => {
    onChange({ ...definition, workspace, updatedAt: Date.now() })
  }

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-host">
          {translate('auto.components.automations.createDestination.label', 'Host')}
        </Label>
        <Select value={hostId} onValueChange={onHostChange}>
          <SelectTrigger id="agents-workflow-host" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hostIds.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {workflowHostLabel(candidate, sshTargetLabels)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-project">
          {translate('auto.components.automations.AutomationEditorDialog.02d351877e', 'Project')}
        </Label>
        <AutomationProjectCombobox
          repos={hostRepos}
          value={definition.runContext.repoId}
          onValueChange={(repoId) => {
            const nextRepo = hostRepos.find((candidate) => candidate.id === repoId)
            if (nextRepo) {
              applyRepo(nextRepo, hostId)
            }
          }}
          placeholder={translate(
            'auto.components.automations.AutomationEditorDialog.0d17f4ca8f',
            'Select project'
          )}
          triggerClassName="h-9 w-full"
          allowAddProject={false}
        />
        {repo && !resolveRunContext(repo, hostId, projectHostSetups) ? (
          <p className="text-xs text-destructive">
            {translate(
              'auto.components.agents-workflow.definition.noProjectSetup',
              'This project has no ready setup on the selected host.'
            )}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-workspace">
          {translate('auto.components.automations.AutomationEditorDialog.b28b140eaf', 'Workspace')}
        </Label>
        <ToggleGroup
          type="single"
          spacing={1}
          value={definition.workspace.mode}
          onValueChange={(mode) => {
            if (mode === 'existing' || mode === 'new_per_run') {
              onWorkspaceChange(workspaceForMode(definition.workspace, mode))
            }
          }}
          size="sm"
          className="w-full"
        >
          <ToggleGroupItem value="existing" className="flex-1">
            {translate('auto.components.automations.AutomationEditorDialog.a2e688226d', 'Worktree')}
          </ToggleGroupItem>
          <ToggleGroupItem value="new_per_run" className="flex-1">
            {translate('auto.components.automations.AutomationEditorDialog.6ff66f9012', 'New run')}
          </ToggleGroupItem>
        </ToggleGroup>
        {definition.workspace.mode === 'existing' ? (
          <WorkspaceCombobox
            worktrees={worktrees}
            value={definition.workspace.workspaceId}
            triggerClassName="min-w-0"
            onValueChange={(workspaceId) => onWorkspaceChange({ mode: 'existing', workspaceId })}
          />
        ) : (
          <CreateFromPicker
            key={definition.runContext.repoId}
            repoId={definition.runContext.repoId}
            repoMap={repoMap}
            worktrees={worktrees}
            value={definition.workspace.baseBranch ?? ''}
            triggerClassName="min-w-0"
            onValueChange={(baseBranch) => {
              const mode = definition.workspace
              onWorkspaceChange({
                mode: 'new_per_run',
                baseBranch: baseBranch || null,
                setupDecision: mode.mode === 'new_per_run' ? mode.setupDecision : 'inherit'
              })
            }}
          />
        )}
      </div>
    </>
  )
}

function workspaceForMode(
  current: AgentsWorkflowWorkspace,
  mode: AgentsWorkflowWorkspace['mode']
): AgentsWorkflowWorkspace {
  if (mode === 'existing') {
    return current.mode === 'existing' ? current : { mode: 'existing', workspaceId: '' }
  }
  return {
    mode: 'new_per_run',
    baseBranch: current.mode === 'new_per_run' ? current.baseBranch : null,
    setupDecision: current.mode === 'new_per_run' ? current.setupDecision : 'inherit'
  }
}

function resetWorkspaceForRepo(current: AgentsWorkflowWorkspace): AgentsWorkflowWorkspace {
  return {
    mode: 'new_per_run',
    baseBranch: null,
    setupDecision: current.mode === 'new_per_run' ? current.setupDecision : 'inherit'
  }
}

function resolveRunContext(
  repo: Repo,
  hostId: string,
  projectHostSetups: readonly ProjectHostSetup[]
): AgentsWorkflowRunContext | null {
  const setups = projectHostSetups.filter(
    (setup) => setup.repoId === repo.id && setup.hostId === hostId
  )
  const setup = setups.find((candidate) => candidate.setupState === 'ready') ?? setups[0] ?? null
  if (!setup) {
    return null
  }
  return buildWorkspaceRunContext({
    projectId: setup.projectId,
    hostId: setup.hostId,
    projectHostSetupId: setup.id,
    repoId: setup.repoId,
    path: setup.path || repo.path
  })
}

export function workflowHostLabel(hostId: string, sshTargetLabels: Map<string, string>): string {
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'ssh') {
    return sshTargetLabels.get(parsed.targetId) ?? parsed.targetId
  }
  return getExecutionHostLabel(normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID)
}
