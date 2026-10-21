/**
 * The channel table claims two things the rosters own: which agents can run a structured
 * session, and which agents leave a readable transcript. Those rosters live in `main`, so the
 * cross-check cannot sit in the shared spec — but it must exist, or a new structured agent would
 * keep falling to the file channel and a new ai-vault agent would silently stop being readable.
 */

import { describe, expect, it } from 'vitest'
import { AI_VAULT_AGENTS } from '../../shared/ai-vault-types'
import { ALL_TUI_AGENTS } from '../../shared/tui-agent-display-names'
import {
  agentsWorkflowAgentChannelPlan,
  agentsWorkflowAgentChannelPlanEntries
} from '../../shared/agents-workflow-agent-channels'
import { structuredAgentRuntimeMetadata } from '../runtime/structured-agent-runtime-metadata'

describe('agents workflow channel plans against the implementing rosters', () => {
  it.each(ALL_TUI_AGENTS)(
    'claims protocol for %s only when a structured session exists',
    (agent) => {
      const claimsProtocol = agentsWorkflowAgentChannelPlan(agent)?.channels.includes('protocol')
      expect(claimsProtocol ?? false).toBe(structuredAgentRuntimeMetadata(agent) !== null)
    }
  )

  it.each(AI_VAULT_AGENTS)('reads %s through its on-disk transcript', (agent) => {
    expect(agentsWorkflowAgentChannelPlan(agent)?.channels).toContain('transcript')
  })

  it('counts the agents each roster really covers', () => {
    const entries = agentsWorkflowAgentChannelPlanEntries()
    expect(entries.filter((entry) => entry.plan.channels.includes('protocol'))).toHaveLength(8)
    expect(entries.filter((entry) => entry.plan.channels.includes('transcript'))).toHaveLength(
      // Why 26: the 25 ai-vault agents plus OpenClaude, which writes Claude's transcript format.
      AI_VAULT_AGENTS.length + 1
    )
  })
})
