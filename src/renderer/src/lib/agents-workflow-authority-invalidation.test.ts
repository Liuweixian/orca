import { describe, expect, it, vi } from 'vitest'
import { AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT } from './agents-workflows-changed-window-event'
import { subscribeAgentsWorkflowAuthorityInvalidation } from './agents-workflow-authority-invalidation'

describe('agent workflow authority invalidation', () => {
  it('coalesces bursts independently for each authority', async () => {
    const invalidate = vi.fn()
    const target = new EventTarget()
    const unsubscribe = subscribeAgentsWorkflowAuthorityInvalidation(invalidate, target)
    const emit = (detail: { reason?: 'definition' | 'run'; environmentId?: string }): void => {
      target.dispatchEvent(new CustomEvent(AGENTS_WORKFLOWS_CHANGED_WINDOW_EVENT, { detail }))
    }

    emit({ reason: 'definition' })
    emit({ reason: 'run' })
    emit({ environmentId: 'remote-1' })
    emit({ environmentId: 'remote-2' })
    emit({ environmentId: 'remote-1' })
    await Promise.resolve()

    expect(invalidate.mock.calls).toEqual([
      [{ kind: 'desktop' }],
      [{ kind: 'runtime', environmentId: 'remote-1' }],
      [{ kind: 'runtime', environmentId: 'remote-2' }]
    ])
    unsubscribe()
  })
})
