// Which channel a workflow node can take its value from, per agent.
//
// A channel is a fact about the host running the workflow, not part of the definition: the same
// graph may resolve differently on a host with an older agent CLI, and an imported definition must
// never carry a claim about what another machine can do. Readers resolve the plan at execution
// time; only the fallback order is shared.

import type { AiVaultAgent } from './ai-vault-types'
import { getTuiAgentRestSignal } from './tui-agent-rest-signal'
import type { TuiAgent } from './tui-agent'
import { ALL_TUI_AGENTS } from './tui-agent-display-names'

export const AGENTS_WORKFLOW_AGENT_CHANNELS = [
  /** A structured agent session reports the committed turn and yields its assistant message. */
  'protocol',
  /** The agent's own on-disk transcript stores the turn; read it after the pane settles. */
  'transcript',
  /** The prompt asks the agent to write its result to a file the run hands it. */
  'file',
  /** The pane's screen text. Always last, and never a value a downstream node may bind. */
  'snapshot'
] as const

export type AgentsWorkflowAgentChannel = (typeof AGENTS_WORKFLOW_AGENT_CHANNELS)[number]

/** How the run learns the pane's turn ended, strongest first. */
export type AgentsWorkflowTurnSettlement =
  /** The structured session's own completion event; no pane guessing involved. */
  | 'completion-event'
  /** The agent's own turn-end hook, or a ready title Orca's hook server writes. */
  | 'hook'
  /** A recognised idle title or ready screen. */
  | 'idle-stable'
  /** Only a quiet pane. Enough to end a report node, never to trust a value. */
  | 'idle-weak'

export type AgentsWorkflowAgentChannelPlan = {
  /** Ordered: the first channel that can deliver supplies the node's value. */
  channels: readonly AgentsWorkflowAgentChannel[]
  /** The ai-vault agent whose session files store this agent's turns, when they do. */
  transcriptSource?: AiVaultAgent
  /** The agent runs in a pane that can write the run's output file. */
  fileHandoff: boolean
}

// Why explicit, not derived: ai-vault membership says a session can be listed, not that the
// transcript carries a turn's assistant message, and structured support is version-gated per
// agent. Each row is a reviewed claim; `agents-workflow-agent-channels.spec.ts` pins protocol and
// transcript against the rosters that implement them, so a new agent cannot be forgotten silently.
export const AGENTS_WORKFLOW_AGENT_CHANNEL_PLANS = {
  claude: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'claude',
    fileHandoff: true
  },
  'claude-agent-teams': {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  codebuddy: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'codebuddy',
    fileHandoff: true
  },
  openclaude: {
    // Why Claude's source: OpenClaude writes the Claude transcript format and layout.
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'claude',
    fileHandoff: true
  },
  codex: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'codex',
    fileHandoff: true
  },
  autohand: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  opencode: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'opencode',
    fileHandoff: true
  },
  opencode2: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'opencode2',
    fileHandoff: true
  },
  'mimo-code': {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  pi: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'pi',
    fileHandoff: true
  },
  omp: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'omp',
    fileHandoff: true
  },
  qoder: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'qoder',
    fileHandoff: true
  },
  'qoder-cn': {
    // Why no transcript: ai-vault reads Qoder's `.qoder/projects` store only, and Qoder China's
    // own CLI is not known to write there.
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  gemini: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'gemini',
    fileHandoff: true
  },
  antigravity: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'antigravity',
    fileHandoff: true
  },
  aider: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  goose: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  amp: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  kilo: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  kiro: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'kiro',
    fileHandoff: true
  },
  crush: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  aug: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  cline: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'cline',
    fileHandoff: true
  },
  codebuff: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  freebuff: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  'command-code': {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  continue: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  cursor: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'cursor',
    fileHandoff: true
  },
  droid: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'droid',
    fileHandoff: true
  },
  kimi: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'kimi',
    fileHandoff: true
  },
  'mistral-vibe': {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  'qwen-code': {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  rovo: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'rovo',
    fileHandoff: true
  },
  hermes: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'hermes',
    fileHandoff: true
  },
  openclaw: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'openclaw',
    fileHandoff: true
  },
  copilot: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'copilot',
    fileHandoff: true
  },
  grok: {
    channels: ['protocol', 'transcript', 'file', 'snapshot'],
    transcriptSource: 'grok',
    fileHandoff: true
  },
  devin: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'devin',
    fileHandoff: true
  },
  ante: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  trae: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  muse: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'muse',
    fileHandoff: true
  },
  zcode: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'zcode',
    fileHandoff: true
  },
  'prime-agent': {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'prime-agent',
    fileHandoff: true
  },
  codely: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  dsh: {
    channels: ['file', 'snapshot'],
    fileHandoff: true
  },
  jcode: {
    channels: ['transcript', 'file', 'snapshot'],
    transcriptSource: 'jcode',
    fileHandoff: true
  }
} as const satisfies Record<TuiAgent, AgentsWorkflowAgentChannelPlan>

export type AgentsWorkflowAgentChannelEntry = {
  agent: TuiAgent
  plan: AgentsWorkflowAgentChannelPlan
  settlement: AgentsWorkflowTurnSettlement
}

export function agentsWorkflowAgentChannelPlan(
  agent: string
): AgentsWorkflowAgentChannelPlan | null {
  return (
    agentsWorkflowAgentChannelPlanEntries().find((entry) => entry.agent === agent)?.plan ?? null
  )
}

export function agentsWorkflowAgentChannelPlanEntries(): readonly AgentsWorkflowAgentChannelEntry[] {
  return ALL_TUI_AGENTS.map((agent) => ({
    agent,
    plan: AGENTS_WORKFLOW_AGENT_CHANNEL_PLANS[agent],
    settlement: agentsWorkflowAgentSettlement(agent)
  }))
}

/**
 * The channels this node may take, in registry order. A terminal node ends its branch, so it never
 * writes an output file; a non-terminal node never reads the screen, because screen text is not a
 * value a downstream node may bind.
 */
export function agentsWorkflowNodeChannels(
  plan: AgentsWorkflowAgentChannelPlan,
  options: {
    terminal: boolean
    /** Channels this host's runners can actually open; missing means "assume the plan". */
    available?: Partial<Record<AgentsWorkflowAgentChannel, boolean>>
  }
): readonly AgentsWorkflowAgentChannel[] {
  return plan.channels.filter(
    (channel) =>
      channel !== (options.terminal ? 'file' : 'snapshot') && (options.available?.[channel] ?? true)
  )
}

/** The channel this node would actually take, or null when the host can run none of them. */
export function agentsWorkflowEffectiveChannel(
  plan: AgentsWorkflowAgentChannelPlan,
  options: {
    terminal: boolean
    available?: Partial<Record<AgentsWorkflowAgentChannel, boolean>>
  }
): AgentsWorkflowAgentChannel | null {
  return agentsWorkflowNodeChannels(plan, options)[0] ?? null
}

/** Whether this plan may take a node's value through `channel`. */
export function agentsWorkflowPlanUsesChannel(
  plan: AgentsWorkflowAgentChannelPlan,
  channel: AgentsWorkflowAgentChannel
): boolean {
  return plan.channels.includes(channel)
}

// Why derived: the pane's rest evidence already has one home (`tui-agent-rest-signal.ts`), and a
// second hand-kept copy of it could only drift from the one the terminal lanes read.
export function agentsWorkflowAgentSettlement(agent: TuiAgent): AgentsWorkflowTurnSettlement {
  if (agentsWorkflowPlanUsesChannel(AGENTS_WORKFLOW_AGENT_CHANNEL_PLANS[agent], 'protocol')) {
    return 'completion-event'
  }
  const rest = getTuiAgentRestSignal(agent)
  if (rest === 'hook-done' || rest === 'synthetic-title') {
    return 'hook'
  }
  if (rest === 'title' || rest === 'ready-body') {
    return 'idle-stable'
  }
  return 'idle-weak'
}
