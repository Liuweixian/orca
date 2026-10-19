import { describe, expect, it } from 'vitest'
import { AgentsWorkflowDefinitionSchema } from './agents-workflow-types'

function validDefinition(): Record<string, unknown> {
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
          source: 'Summarize {{binding:input}}',
          bindings: { input: { kind: 'run_input' } }
        },
        terminal: true
      }
    ],
    edges: [
      {
        id: 'start-draft',
        fromNodeId: 'start',
        toNodeId: 'draft',
        fromPort: 'default',
        toPort: 'default'
      }
    ],
    runContext: {
      kind: 'workspace-run',
      projectId: 'project-1',
      hostId: 'local',
      projectHostSetupId: 'setup-1',
      repoId: 'repo-1',
      path: '/workspace'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, defaultInput: '', schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('AgentsWorkflowDefinitionSchema', () => {
  it('parses the versioned discriminated definition contract', () => {
    expect(AgentsWorkflowDefinitionSchema.safeParse(validDefinition()).success).toBe(true)
  })

  it('rejects fields from another node kind', () => {
    const definition = validDefinition()
    if (
      typeof definition !== 'object' ||
      definition === null ||
      !('nodes' in definition) ||
      !Array.isArray(definition.nodes)
    ) {
      throw new Error('invalid test fixture')
    }
    definition.nodes[0] = {
      id: 'start',
      kind: 'start',
      title: 'Start',
      position: { x: 0, y: 0 },
      terminal: true
    }

    expect(AgentsWorkflowDefinitionSchema.safeParse(definition).success).toBe(false)
  })

  it.each([0, 21])('rejects a fixed loop count of %s', (count) => {
    const definition = validDefinition()
    if (
      typeof definition !== 'object' ||
      definition === null ||
      !('nodes' in definition) ||
      !Array.isArray(definition.nodes)
    ) {
      throw new Error('invalid test fixture')
    }
    definition.nodes.push({
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 100, y: 0 },
      iteration: { mode: 'fixed', count }
    })

    expect(AgentsWorkflowDefinitionSchema.safeParse(definition).success).toBe(false)
  })

  it('rejects unknown agents and future schema versions', () => {
    const definition = validDefinition()
    if (
      typeof definition !== 'object' ||
      definition === null ||
      !('nodes' in definition) ||
      !Array.isArray(definition.nodes)
    ) {
      throw new Error('invalid test fixture')
    }
    definition.schemaVersion = 2
    definition.nodes[1] = {
      id: 'draft',
      kind: 'agent',
      title: 'Draft',
      position: { x: 200, y: 0 },
      agentId: 'unknown-agent',
      prompt: { source: '', bindings: {} },
      terminal: true
    }

    expect(AgentsWorkflowDefinitionSchema.safeParse(definition).success).toBe(false)
  })
})
