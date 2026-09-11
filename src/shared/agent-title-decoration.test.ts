import { describe, expect, it } from 'vitest'
import {
  stripLeadingAgentTitleDecoration,
  stripLeadingAgentTitleDecorationOrEmpty
} from './agent-title-decoration'

describe('stripLeadingAgentTitleDecoration', () => {
  it("strips Claude's ✳ idle glyph", () => {
    expect(stripLeadingAgentTitleDecoration('✳ Claude Code')).toBe('Claude Code')
  })

  it("strips Claude's working/idle text prefixes", () => {
    expect(stripLeadingAgentTitleDecoration('. working on the fix')).toBe('working on the fix')
    expect(stripLeadingAgentTitleDecoration('* Claude Code')).toBe('Claude Code')
  })

  it('strips a leading braille spinner', () => {
    expect(stripLeadingAgentTitleDecoration('⠋ Pi')).toBe('Pi')
  })

  it("strips Codely's waiting and completed-turn prefixes", () => {
    expect(stripLeadingAgentTitleDecoration('\u2705 Codely - orca')).toBe('Codely - orca')
    expect(stripLeadingAgentTitleDecoration('\u23f8\ufe0f Codely - orca')).toBe('Codely - orca')
  })

  it('leaves an undecorated title untouched', () => {
    expect(stripLeadingAgentTitleDecoration('Dolphin-2')).toBe('Dolphin-2')
    expect(stripLeadingAgentTitleDecoration('npm run dev')).toBe('npm run dev')
  })

  it('keeps the original when the title is only a status glyph', () => {
    expect(stripLeadingAgentTitleDecoration('✳')).toBe('✳')
    expect(stripLeadingAgentTitleDecoration('✳ ')).toBe('✳ ')
  })

  it('can strip to empty when the caller supplies its own fallback label', () => {
    expect(stripLeadingAgentTitleDecorationOrEmpty('✳')).toBe('')
    expect(stripLeadingAgentTitleDecorationOrEmpty('✳ ')).toBe('')
  })
})
