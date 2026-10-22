import { describe, expect, it } from 'vitest'
import type { AgentsWorkflowRun } from '../../../shared/agents-workflow-run-types'
import { pageAgentsWorkflowRuns } from './agents-workflow-run-query'

function run(id: string, createdAt: number): AgentsWorkflowRun {
  return {
    schemaVersion: 1,
    id,
    workflowId: 'workflow-1',
    workflowRevision: 1,
    definitionSnapshot: {
      schemaVersion: 1,
      id: 'workflow-1',
      revision: 1,
      name: 'Workflow',
      nodes: [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }],
      edges: [],
      runContext: {
        kind: 'workspace-run',
        projectId: 'project-1',
        hostId: 'local',
        projectHostSetupId: 'setup-1',
        repoId: 'repo-1',
        path: '/repo'
      },
      workspace: { mode: 'existing', workspaceId: 'workspace-1' },
      trigger: { manual: true, schedule: null },
      schedulerOwner: 'local_host_service',
      enabled: true,
      createdAt: 1,
      updatedAt: 1
    },
    requestKey: id,
    trigger: 'manual',
    status: 'completed',
    workspaceId: null,
    workspaceDisplayName: null,
    attempts: [],
    executionTrace: [],
    createdAt,
    startedAt: null,
    finishedAt: createdAt
  }
}

describe('pageAgentsWorkflowRuns', () => {
  it('pages by cursor', () => {
    const runs = [run('c', 3), run('b', 2), run('a', 1)]
    expect(pageAgentsWorkflowRuns(runs, { workflowId: 'workflow-1', limit: 2 })).toMatchObject({
      runs: [{ id: 'c' }, { id: 'b' }],
      nextCursor: 'b'
    })
    expect(
      pageAgentsWorkflowRuns(runs, { workflowId: 'workflow-1', cursor: 'b', limit: 2 })
    ).toEqual({ runs: [expect.objectContaining({ id: 'a' })], nextCursor: null })
  })

  it('returns nothing for a cursor that retention already pruned', () => {
    // Why: starting over at page one made the renderer append duplicates.
    expect(
      pageAgentsWorkflowRuns([run('b', 2), run('a', 1)], {
        workflowId: 'workflow-1',
        cursor: 'pruned-run',
        limit: 20
      })
    ).toEqual({ runs: [], nextCursor: null })
  })
})
