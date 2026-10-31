// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { useAppStore } from '@/store'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import {
  agentsWorkflowGenerationBlocker,
  useAgentsWorkflowGenerationAgent
} from './use-agents-workflow-generation-agent'

function definitionWith(nodes: AgentsWorkflowDefinition['nodes']): AgentsWorkflowDefinition {
  return { ...createAgentsWorkflowPageFixture(), nodes }
}

beforeEach(() => {
  useAppStore.setState({
    ensureNativeDetectedAgents: async () => [],
    localDetectedAgentIdsByContext: { host: ['claude', 'codex'] }
  })
})

afterEach(() => {
  cleanup()
})

describe('useAgentsWorkflowGenerationAgent', () => {
  it('borrows the agent this workflow already uses when the host can run it', () => {
    const definition = definitionWith(
      createAgentsWorkflowPageFixture().nodes.map((node) =>
        node.kind === 'agent' ? { ...node, agentId: 'codex' as const } : node
      )
    )

    const { result } = renderHook(() => useAgentsWorkflowGenerationAgent(definition))

    expect(result.current.agent).toBe('codex')
    expect(result.current.agentIds).toEqual(['claude', 'codex'])
  })

  it('falls back to the default agent for a graph with no agent node yet', () => {
    const definition = definitionWith(
      createAgentsWorkflowPageFixture().nodes.filter(
        (node) => node.kind === 'start' || node.kind === 'end'
      )
    )

    const { result } = renderHook(() => useAgentsWorkflowGenerationAgent(definition))

    expect(result.current.agent).toBe('claude')
  })

  // Why: the dialog lets the user pick the designer, and generation takes the same channel the
  // workflow's nodes take, so every agent this host can run is offered.
  it('offers every agent this host can run as the generator', () => {
    useAppStore.setState({ localDetectedAgentIdsByContext: { host: ['claude', 'gemini'] } })

    const { result } = renderHook(() =>
      useAgentsWorkflowGenerationAgent(
        definitionWith(
          createAgentsWorkflowPageFixture().nodes.filter(
            (node) => node.kind === 'start' || node.kind === 'end'
          )
        )
      )
    )

    expect(result.current.agentIds).toEqual(['claude', 'gemini'])
  })
})

describe('agentsWorkflowGenerationBlocker', () => {
  it('names a workspace target as the blocker before any agent is resolved', () => {
    // The fixture targets a fresh workspace per run, which generation cannot design against.
    const definition = createAgentsWorkflowPageFixture()
    const { result } = renderHook(() => useAgentsWorkflowGenerationAgent(definition))

    expect(agentsWorkflowGenerationBlocker(definition, result.current)).toBe('workspace')
  })

  it('names the missing agent once this host has none installed and enabled', () => {
    useAppStore.setState({ localDetectedAgentIdsByContext: { host: [] } })

    const definition: AgentsWorkflowDefinition = {
      ...createAgentsWorkflowPageFixture(),
      workspace: { mode: 'existing', workspaceId: 'workspace-1' }
    }
    const { result } = renderHook(() => useAgentsWorkflowGenerationAgent(definition))

    expect(result.current.agent).toBeNull()
    expect(agentsWorkflowGenerationBlocker(definition, result.current)).toBe('agent')
  })
})
