import type { TerminalLaunchResult } from './agent-session-resume'

/** Forward only effective launch facts through each existing terminal envelope. */
export function terminalLaunchFacts(result: TerminalLaunchResult): TerminalLaunchResult {
  return {
    ...(result.savedResumeDecision ? { savedResumeDecision: result.savedResumeDecision } : {}),
    ...(result.agentResumeUnavailable
      ? { agentResumeUnavailable: result.agentResumeUnavailable }
      : {}),
    ...(result.agentResumeRefused ? { agentResumeRefused: result.agentResumeRefused } : {}),
    ...(result.refusedResume ? { refusedResume: result.refusedResume } : {}),
    ...(result.launchConfig ? { launchConfig: result.launchConfig } : {}),
    ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
    ...(result.launchToken ? { launchToken: result.launchToken } : {}),
    ...(result.resumeProviderSession ? { resumeProviderSession: result.resumeProviderSession } : {})
  }
}
