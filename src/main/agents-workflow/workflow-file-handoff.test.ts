import { describe, expect, it } from 'vitest'
import {
  AGENTS_WORKFLOW_OUTPUT_CONTRACT_MARKER,
  agentsWorkflowHandoffDirectory,
  agentsWorkflowHandoffPath,
  parseAgentsWorkflowHandoff,
  withAgentsWorkflowOutputContract
} from './workflow-file-handoff'

describe('workflow output contract', () => {
  it('appends the contract after the rendered prompt without rewriting it', () => {
    const prompt = 'Review the diff and summarize it.'
    const withContract = withAgentsWorkflowOutputContract(
      prompt,
      '/repo/.orca-workflow/run/file.json'
    )

    expect(withContract.startsWith(prompt)).toBe(true)
    expect(withContract).toContain(AGENTS_WORKFLOW_OUTPUT_CONTRACT_MARKER)
    expect(withContract).toContain('/repo/.orca-workflow/run/file.json')
    expect(withContract).toContain('Write it as Markdown')
  })

  it('keeps user-authored node ids inside one path segment', () => {
    const path = agentsWorkflowHandoffPath({
      workspacePath: '/repo',
      runId: 'run/../escape',
      nodeId: '../etc/passwd',
      attempt: '1:2'
    })

    expect(path).toBe('/repo/.orca-workflow/run_.._escape/.._etc_passwd-1_2.md')
    expect(agentsWorkflowHandoffDirectory('/repo', 'run-1')).toBe('/repo/.orca-workflow/run-1')
  })

  it('reads the Markdown answer as written', () => {
    expect(parseAgentsWorkflowHandoff('# Answer\n\nAll good.\n')).toEqual({
      ok: true,
      content: '# Answer\n\nAll good.'
    })
  })

  it('treats an empty file as an answer still being written', () => {
    expect(parseAgentsWorkflowHandoff('  \n')).toMatchObject({
      ok: false,
      code: 'output_contract_empty'
    })
  })

  it('refuses a file larger than a workflow value may be', () => {
    expect(parseAgentsWorkflowHandoff('x'.repeat(1024 * 1024 + 1))).toMatchObject({
      ok: false,
      code: 'output_contract_too_large'
    })
  })
})
