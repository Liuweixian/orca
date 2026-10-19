import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as osModule from 'node:os'

const { getPathMock, homedirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
  homedirMock: vi.fn<() => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>()
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { CodelyHookService } from './hook-service'

const WINDOWS_POWERSHELL_LAUNCHER =
  /^[A-Za-z]:\/[^"]*\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe -NoProfile -EncodedCommand \S+$/

const MANAGED_EVENTS = [
  'AfterAgent',
  'AfterTool',
  'AfterToolFailure',
  'BeforeAgent',
  'BeforeTool',
  'Notification'
]

function writeCodelySettings(homeDir: string, hooks: unknown): string {
  const configDir = join(homeDir, '.codely-cli')
  mkdirSync(configDir, { recursive: true })
  const configPath = join(configDir, 'settings.json')
  writeFileSync(configPath, JSON.stringify({ hooks }, null, 2))
  return configPath
}

function staleManagedCommand(): string {
  const managedHookFileName = process.platform === 'win32' ? 'codely-hook.cmd' : 'codely-hook.sh'
  const staleManagedHookPath =
    process.platform === 'win32'
      ? `C:\\Users\\ramzi\\.orca\\agent-hooks\\${managedHookFileName}`
      : `/Users/ramzi/.orca/agent-hooks/${managedHookFileName}`
  return process.platform === 'win32'
    ? staleManagedHookPath
    : `if [ -x '${staleManagedHookPath}' ]; then /bin/sh '${staleManagedHookPath}'; fi`
}

describe('CodelyHookService', () => {
  let homeDir: string
  let userDataDir: string

  beforeAll(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-codely-home-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-codely-userdata-'))
    homedirMock.mockReturnValue(homeDir)
    getPathMock.mockImplementation((name: string) => {
      if (name === 'userData') {
        return userDataDir
      }
      throw new Error(`unexpected getPath(${name})`)
    })
  })

  afterAll(() => {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('removes stale managed PreToolUse hooks when reinstalling managed Codely hooks', () => {
    const configPath = writeCodelySettings(homeDir, {
      BeforeAgent: [
        {
          hooks: [{ type: 'command', command: 'echo user-before-agent' }]
        }
      ],
      PreToolUse: [
        {
          hooks: [{ type: 'command', command: staleManagedCommand() }]
        }
      ]
    })

    const status = new CodelyHookService().install()
    const config = JSON.parse(readFileSync(configPath, 'utf8'))

    expect(status.state).toBe('installed')
    expect(Object.keys(config.hooks).sort()).toEqual([...MANAGED_EVENTS, 'environmentSanitization'])
    expect(config.hooks.environmentSanitization.allowedEnvironmentVariables).toEqual(
      expect.arrayContaining(['ORCA_AGENT_HOOK_TOKEN', 'ORCA_PANE_KEY'])
    )
    expect(config.hooks.PreToolUse).toBeUndefined()
    expect(config.hooks.BeforeAgent).toHaveLength(2)
    expect(config.hooks.BeforeAgent[0].hooks[0].command).toBe('echo user-before-agent')
    const managedHookFileName = process.platform === 'win32' ? 'codely-hook.cmd' : 'codely-hook.sh'
    const managedCommandPattern =
      process.platform === 'win32'
        ? WINDOWS_POWERSHELL_LAUNCHER
        : new RegExp(
            join(homeDir, '.orca', 'agent-hooks', managedHookFileName).replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&'
            )
          )
    for (const eventName of MANAGED_EVENTS) {
      const definitions = config.hooks[eventName]
      const managed = definitions.at(-1)
      expect(managed.hooks[0].command).toMatch(managedCommandPattern)
    }
  })

  // Why: #6078 — a Windows user profile path with a space used to be written
  // verbatim as the hook command, so the agent split it at the space. The
  // managed command must use an encoded launcher so the path never appears raw
  // on the cmd.exe command line.
  it.skipIf(process.platform !== 'win32')(
    'wraps the managed hook command to survive spaces in the profile path (#6078)',
    () => {
      const spaceHome = join(tmpdir(), 'orca codely home with spaces')
      mkdirSync(spaceHome, { recursive: true })
      homedirMock.mockReturnValue(spaceHome)
      try {
        expect(new CodelyHookService().install().state).toBe('installed')

        const config = JSON.parse(
          readFileSync(join(spaceHome, '.codely-cli', 'settings.json'), 'utf8')
        ) as { hooks: Record<string, { hooks: { command: string }[] }[]> }

        for (const eventName of MANAGED_EVENTS) {
          const command = config.hooks[eventName]?.[0]?.hooks?.[0]?.command
          expect(command).toMatch(WINDOWS_POWERSHELL_LAUNCHER)
        }
      } finally {
        rmSync(spaceHome, { recursive: true, force: true })
        homedirMock.mockReturnValue(homeDir)
      }
    }
  )

  it('preserves user-authored hooks across install and remove', () => {
    const configPath = writeCodelySettings(homeDir, {
      environmentSanitization: {
        enableEnvironmentVariableRedaction: true,
        allowedEnvironmentVariables: ['MY_CUSTOM_VAR']
      },
      PreToolUse: [
        {
          hooks: [{ type: 'command', command: staleManagedCommand() }]
        },
        {
          hooks: [{ type: 'command', command: 'echo user-authored' }]
        }
      ]
    })

    const service = new CodelyHookService()
    const installStatus = service.install()
    const afterInstall = JSON.parse(readFileSync(configPath, 'utf8'))
    const preToolCommands = afterInstall.hooks.PreToolUse.flatMap(
      (definition: { hooks?: { command: string }[] }) =>
        (definition.hooks ?? []).map((hook) => hook.command)
    )

    expect(installStatus.state).toBe('installed')
    expect(preToolCommands).toEqual(['echo user-authored'])
    // Why: the managed allowlist must merge with, not replace, the user's own entries.
    expect(afterInstall.hooks.environmentSanitization.allowedEnvironmentVariables).toEqual(
      expect.arrayContaining(['MY_CUSTOM_VAR', 'ORCA_AGENT_HOOK_TOKEN', 'ORCA_PANE_KEY'])
    )
    expect(afterInstall.hooks.environmentSanitization.enableEnvironmentVariableRedaction).toBe(true)

    const removeStatus = service.remove()
    const afterRemove = JSON.parse(readFileSync(configPath, 'utf8'))

    expect(removeStatus.state).toBe('not_installed')
    expect(afterRemove.hooks.PreToolUse).toHaveLength(1)
    expect(afterRemove.hooks.PreToolUse[0].hooks[0].command).toBe('echo user-authored')
    expect(afterRemove.hooks.environmentSanitization.allowedEnvironmentVariables).toEqual([
      'MY_CUSTOM_VAR'
    ])
  })
})
