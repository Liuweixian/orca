import { describe, expect, it } from 'vitest'
import { getLaunchedAgentReadinessLane } from './launched-agent-composer-readiness'

describe('launched agent composer readiness lanes', () => {
  it('keeps codely on the tui-idle lane so its composer gate stays the draft signal', () => {
    // Why: Codely records no composerReadyCaptures, so its launch waits on tui-idle
    // together with its Gemini CLI parent instead of a marker it never proves.
    expect(getLaunchedAgentReadinessLane('codely')).toBe('tui-idle')
    expect(getLaunchedAgentReadinessLane('gemini')).toBe('tui-idle')
  })
})
