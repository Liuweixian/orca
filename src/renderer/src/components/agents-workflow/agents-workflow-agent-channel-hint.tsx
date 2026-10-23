import { translate } from '@/i18n/i18n'
import {
  agentsWorkflowEffectiveChannel,
  type AgentsWorkflowAgentChannel
} from '../../../../shared/agents-workflow-agent-channels'
import type { AgentsWorkflowAgentChannelView } from './agents-workflow-rpc-client'

/** The channel this host would actually take a value from for this node. */
export function effectiveAgentChannel(
  channel: AgentsWorkflowAgentChannelView,
  terminal: boolean
): AgentsWorkflowAgentChannel | null {
  return agentsWorkflowEffectiveChannel(channel.plan, { terminal })
}

function channelHint(channel: AgentsWorkflowAgentChannel | null, agent: string): string {
  switch (channel) {
    case 'protocol':
      return translate(
        'auto.components.agents-workflow.inspector.channelProtocol',
        'This host runs the node in a structured session and passes its answer downstream.'
      )
    case 'transcript':
      return translate(
        'auto.components.agents-workflow.inspector.channelTranscript',
        'This host reads the answer back from the agent transcript.'
      )
    case 'file':
      return translate(
        'auto.components.agents-workflow.inspector.channelFile',
        'This host asks the agent to write its answer to a workflow file.'
      )
    case 'snapshot':
      return translate(
        'auto.components.agents-workflow.inspector.channelSnapshot',
        'This node ends the branch: the run only keeps what its pane printed, and nothing downstream binds it.'
      )
    case null:
      return translate(
        'auto.components.agents-workflow.inspector.channelNone',
        'This host has no output channel for {{agent}}.',
        { agent }
      )
  }
}

/** What this host will do for the selected node's agent; silent while that is unknown. */
export function AgentsWorkflowAgentChannelHint({
  channel,
  terminal
}: {
  channel: AgentsWorkflowAgentChannelView | null
  /** Whether the node feeds only the end node, which lets it settle from its pane. */
  terminal: boolean
}): React.JSX.Element | null {
  if (!channel) {
    return null
  }
  const effective = effectiveAgentChannel(channel, terminal)
  return (
    <p className="text-xs text-muted-foreground">
      {channelHint(effective, channel.agent)}
      {effective === 'file' && channel.settlement === 'idle-weak'
        ? ` ${translate(
            'auto.components.agents-workflow.inspector.channelWeakSettlement',
            'The agent only reports a quiet pane, so the value comes from the output file.'
          )}`
        : null}
    </p>
  )
}
