import { describe, expect, it } from 'vitest'
import { agentsWorkflowLoopCount } from './workflow-runtime-values'

describe('agentsWorkflowLoopCount', () => {
  it('clamps a stored count into the supported range', () => {
    const loop = (count: number) => ({
      id: 'loop',
      kind: 'loop' as const,
      title: 'Loop',
      position: { x: 0, y: 0 },
      count
    })

    expect(agentsWorkflowLoopCount(loop(3))).toBe(3)
    expect(agentsWorkflowLoopCount(loop(0))).toBe(1)
    expect(agentsWorkflowLoopCount(loop(99))).toBe(20)
    expect(agentsWorkflowLoopCount(loop(2.7))).toBe(2)
  })
})
