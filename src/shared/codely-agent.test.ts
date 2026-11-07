import { describe, expect, it } from 'vitest'
import {
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from './agent-status/process/agent-process-recognition'
import { getAgentLabel } from './agent-status/title/agent-title-identity'
import { stripLeadingAgentTitleDecoration } from './agent-status/title/agent-title-decoration'
import { detectAgentStatusFromTitle } from './agent-status/title/agent-title-status'
import { resolveExplicitTerminalTitleAgentType } from './agent-status/title/terminal-title-agent-type'
import { buildAgentStartupPlan } from './agent-launch/startup/tui-agent-startup'
import { TUI_AGENT_CONFIG } from './agent-launch/catalog/tui-agent-config'

describe('Codely agent identity and lifecycle', () => {
  it('recognizes the codely binary and its bundled gemini.js entrypoint', () => {
    expect(recognizeAgentProcess('codely')).toEqual({ agent: 'codely', processName: 'codely' })
    // Why: the npm shim is a direct symlink, so the shebang process runs as `node <bin>/codely`.
    expect(recognizeAgentProcessFromCommandLine('node /opt/homebrew/bin/codely -y')).toEqual({
      agent: 'codely',
      processName: 'codely'
    })
    // Why: Codely's bundle is named gemini.js (Gemini CLI fork); only the exact
    // @codely/cli path is authoritative — it must never read as the gemini agent.
    expect(
      recognizeAgentProcessFromCommandLine(
        'node /opt/homebrew/lib/node_modules/@codely/cli/bundle/gemini.js --yolo'
      )
    ).toEqual({ agent: 'codely', processName: 'codely' })
    expect(
      recognizeAgentProcessFromCommandLine(
        'node /opt/homebrew/lib/node_modules/@google/gemini-cli/bin/gemini.js'
      )
    ).toEqual({ agent: 'gemini', processName: 'gemini' })
  })

  it.each([
    ['Codely - orca', 'idle'],
    ['\u23f8\ufe0f Codely - orca', 'permission'],
    ['codely working', 'working']
  ] as const)('classifies %s', (title, expectedStatus) => {
    expect(getAgentLabel(title)).toBe('Codely')
    expect(detectAgentStatusFromTitle(title)).toBe(expectedStatus)
  })

  it.each(['~/codely/working', 'codely-fixtures ready'])(
    'does not classify path or hyphen false positive %s',
    (title) => {
      expect(getAgentLabel(title)).toBeNull()
      expect(detectAgentStatusFromTitle(title)).toBeNull()
    }
  )

  it("strips Codely's waiting and completed-turn prefixes", () => {
    expect(stripLeadingAgentTitleDecoration('\u2705 Codely - orca')).toBe('Codely - orca')
    expect(stripLeadingAgentTitleDecoration('\u23f8\ufe0f Codely - orca')).toBe('Codely - orca')
  })

  it('maps explicit product-name titles to the codely TuiAgent id', () => {
    // Why: Codely's own base title is "Codely - <dir>"; the name token carries the identity.
    expect(resolveExplicitTerminalTitleAgentType('Codely - orca')).toBe('codely')
    expect(resolveExplicitTerminalTitleAgentType('\u23f8\ufe0f Codely - orca')).toBe('codely')
  })

  it('uses Codely interactive prompt mode like its Gemini CLI parent', () => {
    expect(
      buildAgentStartupPlan({
        agent: 'codely',
        prompt: 'Investigate this regression',
        cmdOverrides: {},
        platform: 'linux'
      })
    ).toMatchObject({
      agent: 'codely',
      launchCommand: "codely --prompt-interactive 'Investigate this regression'",
      expectedProcess: 'codely',
      followupPrompt: null
    })
  })

  it('keeps codely on the composer-cursor paste draft route', () => {
    // Why: the spawn shell's own 2004h anchored the default quiet window, which
    // could fire inside Codely's boot gap under load; the Gemini-CLI family
    // discards stdin that arrives before its composer mounts, silently losing
    // the draft. The composer cursor signal gates delivery on the TUI itself.
    expect(TUI_AGENT_CONFIG.codely.draftPasteReadySignal).toBe(
      'codely-composer-cursor-after-bracketed-paste'
    )
    expect(TUI_AGENT_CONFIG.codely.draftPromptFlag).toBeUndefined()
    expect(TUI_AGENT_CONFIG.codely.draftPromptEnvVar).toBeUndefined()
  })
})
