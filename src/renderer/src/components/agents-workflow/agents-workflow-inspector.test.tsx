// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowNode } from '../../../../shared/agents-workflow-types'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import { AgentsWorkflowInspector } from './agents-workflow-inspector'
import type { AgentsWorkflowAgentChannelView } from './agents-workflow-rpc-client'

type AgentNode = Extract<AgentsWorkflowNode, { kind: 'agent' }>

function agentNode(agentId: AgentNode['agentId']): AgentNode {
  const fixture = createAgentsWorkflowPageFixture(100)
  const node = fixture.nodes.find((candidate) => candidate.kind === 'agent')
  if (!node || node.kind !== 'agent') {
    throw new Error('fixture has no agent node')
  }
  return { ...node, agentId }
}

function channel(
  overrides: Partial<AgentsWorkflowAgentChannelView> & {
    channels?: AgentsWorkflowAgentChannelView['plan']['channels']
    settlement?: AgentsWorkflowAgentChannelView['settlement']
  } = {}
): AgentsWorkflowAgentChannelView {
  return {
    agent: 'gemini',
    plan: {
      channels: overrides.channels ?? ['transcript', 'file', 'snapshot'],
      transcriptSource: 'gemini',
      fileHandoff: true
    },
    settlement: overrides.settlement ?? 'idle-stable'
  }
}

function renderInspector(agentChannel: AgentsWorkflowAgentChannelView | null) {
  return render(
    <AgentsWorkflowInspector
      node={agentNode('gemini')}
      issues={[]}
      agentChannel={agentChannel}
      onChange={vi.fn()}
    />
  )
}

afterEach(cleanup)

describe('AgentsWorkflowInspector channel hint', () => {
  it('names the transcript channel this host would use', () => {
    renderInspector(channel())

    expect(screen.getByText(/reads the answer back from the agent transcript/i)).not.toBeNull()
  })

  it('names the output file when the host has no stronger channel', () => {
    renderInspector(channel({ channels: ['file', 'snapshot'] }))

    expect(screen.getByText(/write its answer to a workflow file/i)).not.toBeNull()
  })

  it('warns when a file-channel agent only reports a quiet pane', () => {
    renderInspector(channel({ channels: ['file', 'snapshot'], settlement: 'idle-weak' }))

    expect(screen.getByText(/only reports a quiet pane/i)).not.toBeNull()
  })

  it('does not claim a file for a terminal node, which ends the branch', () => {
    render(
      <AgentsWorkflowInspector
        node={{ ...agentNode('gemini'), terminal: true }}
        issues={[]}
        agentChannel={channel({ channels: ['file', 'snapshot'] })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText(/ends the branch/i)).not.toBeNull()
    expect(screen.queryByText(/write its answer to a workflow file/i)).toBeNull()
  })

  it('says nothing while the host has not answered', () => {
    renderInspector(null)

    expect(screen.queryByText(/agent transcript|workflow file|quiet pane/i)).toBeNull()
  })
})
