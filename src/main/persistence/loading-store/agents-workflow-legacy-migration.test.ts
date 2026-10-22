import { describe, expect, it } from 'vitest'
import { AgentsWorkflowDefinitionSchema } from '../../../shared/agents-workflow-types'
import { AgentsWorkflowRunSchema } from '../../../shared/agents-workflow-run-types'
import {
  migrateLegacyAgentsWorkflowDefinition,
  migrateLegacyAgentsWorkflowRun
} from './agents-workflow-legacy-migration'

function legacyDefinition(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'workflow-1',
    revision: 1,
    name: 'Release notes',
    nodes: [
      { id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } },
      {
        id: 'draft',
        kind: 'agent',
        title: 'Draft',
        position: { x: 200, y: 0 },
        agentId: 'claude',
        prompt: {
          source: 'Read {{binding:input}} then summarize.',
          bindings: {
            input: { kind: 'run_input' },
            upstream: { kind: 'node_output', nodeId: 'start' }
          }
        },
        terminal: false
      },
      {
        id: 'check',
        kind: 'condition',
        title: 'Check',
        position: { x: 300, y: 0 },
        input: { kind: 'run_input' },
        operator: 'not_empty'
      },
      {
        id: 'loop',
        kind: 'loop',
        title: 'Loop',
        position: { x: 400, y: 0 },
        iteration: { mode: 'fixed', count: 3 }
      }
    ],
    edges: [],
    runContext: {
      kind: 'workspace-run',
      projectId: 'project-1',
      hostId: 'local',
      projectHostSetupId: 'setup-1',
      repoId: 'repo-1',
      path: '/workspace'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, defaultInput: 'review', schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('legacy agents workflow migration', () => {
  it('rewrites variables, judge conditions and loop counts into the current shape', () => {
    const migrated = migrateLegacyAgentsWorkflowDefinition(legacyDefinition())
    const parsed = AgentsWorkflowDefinitionSchema.safeParse(migrated)

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      return
    }
    expect(parsed.data.trigger).toEqual({ manual: true, schedule: null })
    expect(parsed.data.nodes[1]).toMatchObject({
      kind: 'agent',
      prompt: { source: 'Read  then summarize.' }
    })
    expect(parsed.data.nodes[2]).toMatchObject({
      kind: 'condition',
      agentId: 'claude',
      prompt: {
        source:
          'Read the answer this node inherits and decide whether it is not empty. Answer with {"decision":"yes"} or {"decision":"no"}.'
      }
    })
    expect(parsed.data.nodes[3]).toMatchObject({ kind: 'loop', count: 3 })
  })

  it('leaves an already-current definition untouched', () => {
    const definition: Record<string, unknown> = {
      ...legacyDefinition(),
      trigger: { manual: true, schedule: null }
    }
    if (!Array.isArray(definition.nodes)) {
      throw new Error('fixture is missing nodes')
    }
    const nodes = definition.nodes
    nodes[1] = {
      ...nodes[1],
      prompt: { source: 'Summarize the change.' }
    }
    nodes[2] = {
      id: 'check',
      kind: 'condition',
      title: 'Check',
      position: { x: 300, y: 0 },
      agentId: 'claude',
      prompt: { source: 'Decide whether the change is small.' }
    }
    nodes[3] = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 400, y: 0 },
      count: 2
    }

    expect(migrateLegacyAgentsWorkflowDefinition(definition)).toEqual(definition)
  })

  it('drops the stored run input and migrates the snapshot', () => {
    const run = {
      schemaVersion: 1,
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowRevision: 1,
      definitionSnapshot: legacyDefinition(),
      requestKey: 'request-1',
      trigger: 'manual',
      input: 'review',
      status: 'completed',
      workspaceId: null,
      workspaceDisplayName: null,
      attempts: [],
      executionTrace: [],
      createdAt: 1,
      startedAt: 1,
      finishedAt: 2
    }

    const parsed = AgentsWorkflowRunSchema.safeParse(migrateLegacyAgentsWorkflowRun(run))

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      return
    }
    expect(parsed.data).not.toHaveProperty('input')
    expect(parsed.data.definitionSnapshot.trigger).toEqual({ manual: true, schedule: null })
  })
})
