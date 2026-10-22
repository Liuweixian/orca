import { describe, expect, it } from 'vitest'
import {
  agentsWorkflowPathSegment,
  agentsWorkflowRunDirectory
} from './agents-workflow-output-paths'

describe('agentsWorkflowPathSegment', () => {
  it('turns dot-only ids into a plain folder name', () => {
    // Why: the segment becomes a folder this module's caller removes recursively, and `..` would
    // point at the worktree root.
    expect(agentsWorkflowPathSegment('.')).toBe('unnamed')
    expect(agentsWorkflowPathSegment('..')).toBe('unnamed')
  })

  it('keeps a run inside the workflow output folder for a traversal-shaped id', () => {
    expect(agentsWorkflowRunDirectory('/repo', '..')).toBe('/repo/.orca-workflow/unnamed')
  })

  it('prefixes a name Windows reserves', () => {
    expect(agentsWorkflowPathSegment('CON')).toBe('_CON')
    expect(agentsWorkflowPathSegment('lpt1.md')).toBe('_lpt1.md')
  })

  it('leaves an ordinary id unchanged', () => {
    expect(agentsWorkflowPathSegment('run-1_2')).toBe('run-1_2')
  })
})
