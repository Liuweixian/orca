import { describe, expect, it } from 'vitest'
import { buildAgentsWorkflowCommandSpec } from './agents-workflow-command'

describe('buildAgentsWorkflowCommandSpec', () => {
  it('runs the command line through sh on POSIX', () => {
    expect(buildAgentsWorkflowCommandSpec('pnpm test', 'linux', {})).toEqual({
      program: '/bin/sh',
      args: ['-c', 'pnpm test']
    })
  })

  it('hands the command line to cmd.exe on Windows without Node re-quoting it', () => {
    expect(
      buildAgentsWorkflowCommandSpec('pnpm test', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' })
    ).toEqual({
      program: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', '"pnpm test"'],
      windowsVerbatimArguments: true
    })
  })
})
