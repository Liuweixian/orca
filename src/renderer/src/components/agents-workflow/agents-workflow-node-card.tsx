import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Bot,
  CirclePlay,
  CircleStop,
  GitBranch,
  Repeat2,
  Terminal
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentsWorkflowCanvasNode } from './agents-workflow-canvas-model'

const HANDLE_CLASS = 'size-2.5 border-2 border-background bg-foreground'

function nodeKindLabel(kind: AgentsWorkflowCanvasNode['data']['workflowNode']['kind']): string {
  switch (kind) {
    case 'start':
      return translate('auto.components.agents-workflow.node.start', 'Start')
    case 'end':
      return translate('auto.components.agents-workflow.node.end', 'End')
    case 'agent':
      return translate('auto.components.agents-workflow.node.agent', 'Agent')
    case 'condition':
      return translate('auto.components.agents-workflow.node.condition', 'Condition')
    case 'command':
      return translate('auto.components.agents-workflow.node.command', 'Command')
    case 'loop':
      return translate('auto.components.agents-workflow.node.loop', 'Loop')
  }
}

function NodeKindIcon({
  kind
}: {
  kind: AgentsWorkflowCanvasNode['data']['workflowNode']['kind']
}): React.JSX.Element {
  const className = 'size-4'
  switch (kind) {
    case 'start':
      return <CirclePlay className={className} />
    case 'end':
      return <CircleStop className={className} />
    case 'agent':
      return <Bot className={className} />
    case 'condition':
      return <GitBranch className={className} />
    case 'command':
      return <Terminal className={className} />
    case 'loop':
      return <Repeat2 className={className} />
  }
}

function TargetHandles({
  kind
}: {
  kind: AgentsWorkflowCanvasNode['data']['workflowNode']['kind']
}): React.JSX.Element | null {
  if (kind === 'start') {
    return null
  }
  return (
    <>
      <Handle id="default" type="target" position={Position.Left} className={HANDLE_CLASS} />
      {kind === 'loop' ? (
        <Handle id="aggregate" type="target" position={Position.Bottom} className={HANDLE_CLASS} />
      ) : null}
    </>
  )
}

function SourceHandles({
  node
}: {
  node: AgentsWorkflowCanvasNode['data']['workflowNode']
}): React.JSX.Element | null {
  if (node.kind === 'condition') {
    return (
      <>
        <Handle id="yes" type="source" position={Position.Right} className={HANDLE_CLASS} />
        <Handle id="no" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      </>
    )
  }
  if (node.kind === 'loop') {
    return (
      <>
        <Handle id="each" type="source" position={Position.Right} className={HANDLE_CLASS} />
        <Handle id="done" type="source" position={Position.Top} className={HANDLE_CLASS} />
      </>
    )
  }
  if (node.kind === 'end') {
    // End is the sink: no outgoing connection may leave it.
    return null
  }
  return <Handle id="default" type="source" position={Position.Right} className={HANDLE_CLASS} />
}

function AgentsWorkflowNodeCardComponent({
  data,
  selected
}: NodeProps<AgentsWorkflowCanvasNode>): React.JSX.Element {
  const node = data.workflowNode
  const hasErrors = data.issues.some((entry) => entry.severity === 'error')
  const agentId = node.kind === 'agent' || node.kind === 'condition' ? node.agentId : null
  // Why narrower: end only carries a title, so it does not need a work node's width.
  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-xs',
        node.kind === 'end' ? 'w-32' : 'w-56',
        selected ? 'border-ring ring-2 ring-ring' : 'border-border',
        hasErrors && 'border-destructive'
      )}
    >
      <TargetHandles kind={node.kind} />
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-muted-foreground">
          <NodeKindIcon kind={node.kind} />
        </div>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</div>
        {hasErrors ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : null}
      </div>
      {node.kind === 'start' || node.kind === 'end' ? null : (
        <div
          className={cn(
            'mt-1 flex items-center gap-2 text-xs text-muted-foreground',
            // Same icon width and gap as the title row, so both text columns line up.
            agentId === null && 'pl-6'
          )}
        >
          {agentId === null ? null : (
            <>
              <AgentIcon agent={agentId} size={16} />
              <Badge variant="secondary">{getAgentLabel(agentId)}</Badge>
            </>
          )}
          <span>{nodeKindLabel(node.kind)}</span>
        </div>
      )}
      {node.kind === 'command' && node.command.trim() ? (
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{node.command}</div>
      ) : null}
      <SourceHandles node={node} />
    </div>
  )
}

export const AgentsWorkflowNodeCard = React.memo(AgentsWorkflowNodeCardComponent)
