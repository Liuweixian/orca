import type { TuiAgent } from './tui-agent'
import { skipsLinuxOrcaCliRename } from './orca-cli-command-name'
import type { TuiAgentConfig, TuiAgentConfigSource } from './tui-agent-config-types'
import { TUI_AGENT_CONFIG_SOURCE } from './tui-agent-config-entries'

export type {
  AgentPromptInjectionMode,
  DraftPasteMarkerSignal,
  DraftPasteReadySignal,
  TuiAgentConfig,
  TuiAgentDetectionRuntime
} from './tui-agent-config-types'

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
  if (platform === 'linux' && skipsLinuxOrcaCliRename(opts?.isRemote)) {
    return config.launchCmd
  }
  return config.launchCmdByPlatform?.[platform] ?? config.launchCmd
}
