import React from 'react'
import {
  listAgentsWorkflowAgentChannels,
  type AgentsWorkflowAgentChannelView
} from './agents-workflow-rpc-client'

export type AgentsWorkflowAgentChannelMap = ReadonlyMap<string, AgentsWorkflowAgentChannelView>

/**
 * What this host can do per agent. Null while it is unknown: an unreadable list must not read as
 * "nothing is supported", so the UI stays silent instead of promising a channel.
 */
export function useAgentsWorkflowAgentChannels(): AgentsWorkflowAgentChannelMap | null {
  const [channels, setChannels] = React.useState<AgentsWorkflowAgentChannelMap | null>(null)

  React.useEffect(() => {
    let disposed = false
    void listAgentsWorkflowAgentChannels()
      .then((entries) => {
        if (!disposed) {
          setChannels(new Map(entries.map((entry) => [entry.agent, entry])))
        }
      })
      .catch(() => {
        if (!disposed) {
          setChannels(null)
        }
      })
    return () => {
      disposed = true
    }
  }, [])

  return channels
}
