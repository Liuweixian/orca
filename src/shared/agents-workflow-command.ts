// How a command node's command line reaches the OS shell.
//
// The node stores one string the author typed, so it must run through a shell; on Windows that
// means cmd.exe, which does not understand Node's backslash quoting of inner quotes.

export type AgentsWorkflowCommandSpec = {
  program: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

export function buildAgentsWorkflowCommandSpec(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): AgentsWorkflowCommandSpec {
  if (platform === 'win32') {
    // Why the extra quotes with verbatim arguments: `/s` strips them and cmd.exe takes the rest
    // as-is, which is exactly Node's own `shell: true` form.
    return {
      program: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`],
      windowsVerbatimArguments: true
    }
  }
  return { program: '/bin/sh', args: ['-c', command] }
}
