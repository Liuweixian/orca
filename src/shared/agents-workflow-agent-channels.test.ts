/**
 * Every agent a workflow may reference must have a reviewed channel plan, and the plan must stay
 * in the one shape the executor relies on: a non-empty ordered list that ends in evidence-only
 * `snapshot`, with `protocol` first where it exists.
 *
 * The rosters that actually implement `protocol` and `transcript` live outside `shared`, so the
 * cross-checks against them sit in `src/main/agents-workflow/agents-workflow-agent-channels.test.ts`.
 * What is pinned here is the table's own shape and the promise that no agent is value-less.
 */

import { describe, expect, it } from 'vitest'
import { ALL_TUI_AGENTS } from './tui-agent-display-names'
import { isAiVaultAgent } from './ai-vault-types'
import {
  AGENTS_WORKFLOW_AGENT_CHANNELS,
  agentsWorkflowAgentChannelPlan,
  agentsWorkflowAgentChannelPlanEntries,
  agentsWorkflowAgentSettlement
} from './agents-workflow-agent-channels'

describe('agents workflow agent channel plans', () => {
  it('covers every agent exactly once', () => {
    const planned = agentsWorkflowAgentChannelPlanEntries().map((entry) => entry.agent)
    expect(planned.slice().sort()).toEqual(ALL_TUI_AGENTS.slice().sort())
  })

  it.each(ALL_TUI_AGENTS)('declares an ordered channel list for %s', (agent) => {
    const plan = agentsWorkflowAgentChannelPlan(agent)
    expect(plan).not.toBeNull()
    const channels = plan?.channels ?? []
    expect(channels.length).toBeGreaterThan(0)
    expect(new Set(channels).size).toBe(channels.length)
    // Nothing is more trustworthy than a protocol turn, and screen text is always the last resort.
    if (channels.includes('protocol')) {
      expect(channels[0]).toBe('protocol')
    }
    expect(channels.at(-1)).toBe('snapshot')
    expect(channels.indexOf('file')).toBeLessThan(channels.indexOf('snapshot'))
  })

  it.each(ALL_TUI_AGENTS)('names a real transcript source for %s when it has one', (agent) => {
    const source = agentsWorkflowAgentChannelPlan(agent)?.transcriptSource
    if (source === undefined) {
      return
    }
    expect(isAiVaultAgent(source)).toBe(true)
    expect(agentsWorkflowAgentChannelPlan(agent)?.channels).toContain('transcript')
  })

  it.each(ALL_TUI_AGENTS)('keeps transcript claims inside the ai-vault roster for %s', (agent) => {
    const plan = agentsWorkflowAgentChannelPlan(agent)
    if (plan?.channels.includes('transcript')) {
      expect(plan.transcriptSource).toBeDefined()
    }
  })

  it('reports completion events only for protocol agents', () => {
    for (const agent of ALL_TUI_AGENTS) {
      const usesProtocol = agentsWorkflowAgentChannelPlan(agent)?.channels.includes('protocol')
      expect(agentsWorkflowAgentSettlement(agent) === 'completion-event').toBe(
        usesProtocol === true
      )
    }
  })

  it('never claims a stronger settlement than the pane evidence supports', () => {
    for (const agent of ALL_TUI_AGENTS) {
      expect(['completion-event', 'hook', 'idle-stable', 'idle-weak']).toContain(
        agentsWorkflowAgentSettlement(agent)
      )
    }
  })

  it('keeps the channel vocabulary stable', () => {
    expect(AGENTS_WORKFLOW_AGENT_CHANNELS).toEqual(['protocol', 'transcript', 'file', 'snapshot'])
  })

  it('reads an unknown agent as unplanned instead of guessing', () => {
    expect(agentsWorkflowAgentChannelPlan('not-an-agent')).toBeNull()
  })
})
