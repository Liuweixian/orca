import React from 'react'
import { AgentsWorkflowPageSurface } from './AgentsWorkflowPageSurface'
import { useAgentsWorkflowPageController } from './use-agents-workflow-page-controller'

export default function AgentsWorkflowPage(): React.JSX.Element {
  return <AgentsWorkflowPageSurface controller={useAgentsWorkflowPageController()} />
}
