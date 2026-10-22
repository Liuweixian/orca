import { describe, expect, it } from 'vitest'
import {
  agentsWorkflowPromptDeclaresDecision,
  parseAgentsWorkflowDecision
} from './agents-workflow-decision'

describe('agentsWorkflowPromptDeclaresDecision', () => {
  it('accepts the shape the runtime parses, including hand-written spacing', () => {
    expect(
      agentsWorkflowPromptDeclaresDecision('Answer with {"decision":"yes"} or {"decision":"no"}.')
    ).toBe(true)
    expect(
      agentsWorkflowPromptDeclaresDecision(
        'Answer with { "decision" : "YES" } or { "decision" : "NO" }'
      )
    ).toBe(true)
  })

  it('accepts a prose description of the same contract', () => {
    // Why: the runtime only needs the agent to emit "yes" or "no" in the decision field; demanding
    // the literal JSON in the prompt rejected prompts that still describe it unambiguously.
    expect(
      agentsWorkflowPromptDeclaresDecision(
        'Judge whether the change is small. Set the decision field to yes or no.'
      )
    ).toBe(true)
  })

  it('rejects a prompt that only asks for one branch or none at all', () => {
    expect(agentsWorkflowPromptDeclaresDecision('Answer with {"decision":"yes"}.')).toBe(false)
    expect(agentsWorkflowPromptDeclaresDecision('Answer yes or no.')).toBe(false)
    expect(agentsWorkflowPromptDeclaresDecision('')).toBe(false)
  })
})

describe('parseAgentsWorkflowDecision', () => {
  it('reads the decision field of a JSON answer', () => {
    expect(parseAgentsWorkflowDecision('{"decision":"yes"}')).toBe('yes')
    expect(parseAgentsWorkflowDecision('{"decision":" NO "}')).toBe('no')
    expect(parseAgentsWorkflowDecision('  {"decision":"yes","reason":"small"}  ')).toBe('yes')
  })

  it('reads a decision an agent wrapped in a fenced block or prose', () => {
    expect(parseAgentsWorkflowDecision('```json\n{"decision":"yes"}\n```')).toBe('yes')
    expect(parseAgentsWorkflowDecision('The change is small.\n\n{"decision":"no"}')).toBe('no')
    expect(parseAgentsWorkflowDecision('```\n{"decision": "yes"}\n```\nDone.')).toBe('yes')
  })

  it('rejects prose and answers without a usable decision', () => {
    expect(parseAgentsWorkflowDecision('Yes, it is small.')).toBeNull()
    expect(parseAgentsWorkflowDecision('{"decision":"maybe"}')).toBeNull()
    expect(parseAgentsWorkflowDecision('{"decision":true}')).toBeNull()
    expect(parseAgentsWorkflowDecision('["yes"]')).toBeNull()
    expect(parseAgentsWorkflowDecision('')).toBeNull()
  })
})
