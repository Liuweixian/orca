// Which agent designs a workflow, and which ones a generated graph may name. Both follow the same
// detected/enabled/default resolution the rest of the app uses for launching an agent.

import React from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { pickSourceControlLaunchAgent } from '../../../../shared/source-control-launch-agent-selection'
import { filterEnabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { readNativeDetectedAgents } from '@/store/slices/local-detected-agent-store-state'
import { useAppStore } from '@/store'

export type AgentsWorkflowGenerationAgent = {
  /** Pending until the host says which agents it can run. */
  status: 'pending' | 'ready'
  /** The agent that designs the graph; null when this host has nothing installed and enabled. */
  agent: TuiAgent | null
  /** Agents a generated node may name; empty while the host is still being probed. */
  agentIds: TuiAgent[]
}

export function useAgentsWorkflowGenerationAgent(
  definition: AgentsWorkflowDefinition,
  options: {
    /** Only a user act (opening the dialog) may kick off an agent probe; the page just reads it. */
    ensureDetection?: boolean
  } = {}
): AgentsWorkflowGenerationAgent {
  const ensureDetected = useAppStore((state) => state.ensureNativeDetectedAgents)
  const defaultAgent = useAppStore((state) => state.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const detected = useAppStore(readNativeDetectedAgents)
  const shouldEnsureDetection = options.ensureDetection !== false
  React.useEffect(() => {
    if (shouldEnsureDetection) {
      void ensureDetected()
    }
  }, [ensureDetected, shouldEnsureDetection])

  const workflowAgent = definition.nodes.find(
    (node) => node.kind === 'agent' || node.kind === 'condition'
  )?.agentId
  return React.useMemo(() => {
    if (detected === null) {
      return { status: 'pending', agent: null, agentIds: [] }
    }
    return {
      status: 'ready',
      agent: pickSourceControlLaunchAgent({
        savedAgent: workflowAgent ?? null,
        defaultAgent,
        detectedAgents: detected,
        disabledAgents
      }),
      // Why every enabled agent: generation takes the same channel a node takes, so anything this
      // host can run is a candidate. The host narrows the list again before prompting the agent.
      agentIds: filterEnabledTuiAgents(detected, disabledAgents)
    }
  }, [defaultAgent, detected, disabledAgents, workflowAgent])
}

/** Why generation is unavailable, so the top bar can explain it before the dialog opens. */
export function agentsWorkflowGenerationBlocker(
  definition: AgentsWorkflowDefinition,
  readiness: Pick<AgentsWorkflowGenerationAgent, 'status' | 'agent'>
): 'workspace' | 'agent' | null {
  if (definition.workspace.mode !== 'existing') {
    return 'workspace'
  }
  if (readiness.status !== 'ready') {
    return null
  }
  return readiness.agent === null ? 'agent' : null
}
