import type { TuiAgent } from './tui-agent'
import type { TuiAgentConfig } from './tui-agent-config-types'
import { TUI_AGENT_CONFIG_SOURCE } from './tui-agent-config-entries'

export type {
  AgentPromptInjectionMode,
  DraftPasteMarkerSignal,
  DraftPasteReadySignal,
  TuiAgentConfig,
  TuiAgentDetectionRuntime
} from './tui-agent-config-types'

/** Authoring form: `launchCmd` and `expectedProcess` default to `detectCmd` (true for most agents). */
export type TuiAgentConfigSource = Omit<TuiAgentConfig, 'launchCmd' | 'expectedProcess'> & {
  launchCmd?: string
  expectedProcess?: string
}

function resolveTuiAgentConfig(source: TuiAgentConfigSource): TuiAgentConfig {
  return {
    ...source,
    launchCmd: source.launchCmd ?? source.detectCmd,
    expectedProcess: source.expectedProcess ?? source.detectCmd
  }
}

export const TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig> = Object.fromEntries(
  Object.entries(TUI_AGENT_CONFIG_SOURCE).map(([agent, source]) => [
    agent,
    resolveTuiAgentConfig(source)
  ])
) as Record<TuiAgent, TuiAgentConfig>

export function isTuiAgent(value: unknown): value is TuiAgent {
  return typeof value === 'string' && Object.hasOwn(TUI_AGENT_CONFIG, value)
}

export function getTuiAgentDetectCommands(config: TuiAgentConfig): string[] {
  return [config.detectCmd, ...(config.detectCmdAliases ?? [])]
}

export function getTuiAgentLaunchCommand(
  config: TuiAgentConfig,
  platform: NodeJS.Platform,
  opts?: { isRemote?: boolean }
): string {
  // Why: local-only orca-ide rename (avoids GNOME Orca clash) must not leak to Linux remotes, whose relay shim is always `orca`.
  if (opts?.isRemote && platform === 'linux') {
    return config.launchCmd
  }
  return config.launchCmdByPlatform?.[platform] ?? config.launchCmd
}
