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

  it('rejects prose and answers without a usable decision', () => {
    expect(parseAgentsWorkflowDecision('Yes, it is small.')).toBeNull()
    expect(parseAgentsWorkflowDecision('{"decision":"maybe"}')).toBeNull()
    expect(parseAgentsWorkflowDecision('{"decision":true}')).toBeNull()
    expect(parseAgentsWorkflowDecision('["yes"]')).toBeNull()
    expect(parseAgentsWorkflowDecision('')).toBeNull()
  })
})
