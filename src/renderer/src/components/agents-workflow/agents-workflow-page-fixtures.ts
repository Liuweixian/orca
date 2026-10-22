import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'

export function createAgentsWorkflowPageFixture(now = Date.now()): AgentsWorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'fixture-release-notes',
    revision: 1,
    name: 'Release notes',
    nodes: [
      {
        id: 'start',
        kind: 'start',
        title: 'Start',
        position: { x: 80, y: 180 }
      },
      {
        id: 'research',
        kind: 'agent',
        title: 'Research changes',
        position: { x: 340, y: 180 },
        agentId: 'claude',
        prompt: { source: 'Review the repository changes in this workspace.' },
        terminal: false
      },
      {
        id: 'publish',
        kind: 'agent',
        title: 'Draft release notes',
        position: { x: 620, y: 180 },
        agentId: 'claude',
        prompt: { source: 'Write the release notes for this change.' },
        terminal: true
      }
    ],
    edges: [
      {
        id: 'start-research',
        fromNodeId: 'start',
        toNodeId: 'research',
        fromPort: 'default',
        toPort: 'default'
      },
      {
        id: 'research-publish',
        fromNodeId: 'research',
        toNodeId: 'publish',
        fromPort: 'default',
        toPort: 'default'
      }
    ],
    runContext: {
      kind: 'workspace-run',
      projectId: 'fixture-project',
      hostId: 'local',
      projectHostSetupId: 'fixture-setup',
      repoId: 'fixture-repo',
      path: '.'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
}
