import { describe, expect, it } from 'vitest'
import { agentsWorkflowBackEdgeRoute } from './agents-workflow-back-edge-route'

describe('agentsWorkflowBackEdgeRoute', () => {
  it('routes below both endpoints and keeps the label on the gutter', () => {
    const route = agentsWorkflowBackEdgeRoute({
      sourceX: 480,
      sourceY: 220,
      targetX: 240,
      targetY: 160
    })

    expect(route.labelX).toBe(360)
    expect(route.labelY).toBe(292)
    expect(route.path).toContain('L 480 276')
    expect(route.path).toContain('L 240 160')
  })
})
