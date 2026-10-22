import React from 'react'
import { Bot, GitBranch, Repeat2, Trash2, Unplug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type {
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../../../shared/agents-workflow-types'
import type { AgentsWorkflowNodeKindToAdd } from './agents-workflow-node-factory'

export function AgentsWorkflowCanvasContextMenu({
  nodeMenuNode,
  edgeMenuId,
  onAddNode,
  onDeleteNode,
  onDeleteEdge
}: {
  nodeMenuNode: AgentsWorkflowNode | null
  edgeMenuId: string | null
  onAddNode: (kind: AgentsWorkflowNodeKindToAdd) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (id: string) => void
}): React.JSX.Element {
  if (nodeMenuNode) {
    return (
      <ContextMenuContent>
        <ContextMenuItem
          variant="destructive"
          disabled={nodeMenuNode.kind === 'start'}
          onSelect={() => onDeleteNode(nodeMenuNode.id)}
        >
          <Trash2 />
          {translate('auto.components.agents-workflow.canvas.deleteNode', 'Delete node')}
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }
  if (edgeMenuId) {
    return (
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={() => onDeleteEdge(edgeMenuId)}>
          <Unplug />
          {translate(
            'auto.components.agents-workflow.canvas.deleteConnection',
            'Delete connection'
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onAddNode('agent')}>
        <Bot />
        {translate('auto.components.agents-workflow.canvas.addAgent', 'Agent')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onAddNode('condition')}>
        <GitBranch />
        {translate('auto.components.agents-workflow.canvas.addCondition', 'Condition')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onAddNode('loop')}>
        <Repeat2 />
        {translate('auto.components.agents-workflow.canvas.addLoop', 'Loop')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

export type AgentsWorkflowConnectionDrop = {
  screen: { x: number; y: number }
  fromNodeId: string
  fromPort: AgentsWorkflowEdge['fromPort']
}

export function AgentsWorkflowConnectionDropMenu({
  dropTarget,
  onCreateConnectedNode,
  onDismiss
}: {
  dropTarget: AgentsWorkflowConnectionDrop | null
  onCreateConnectedNode: (kind: AgentsWorkflowNodeKindToAdd) => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu
      open={dropTarget !== null}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss()
        }
      }}
      modal={false}
    >
      {/* Why a zero-size fixed div: DropdownMenu anchors to its trigger, so this
          invisible point is where the connection drag was released. */}
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: dropTarget?.screen.x ?? 0,
            top: dropTarget?.screen.y ?? 0,
            width: 0,
            height: 0,
            pointerEvents: 'none'
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onCreateConnectedNode('agent')}>
          <Bot />
          {translate('auto.components.agents-workflow.canvas.addAgent', 'Agent')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreateConnectedNode('condition')}>
          <GitBranch />
          {translate('auto.components.agents-workflow.canvas.addCondition', 'Condition')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreateConnectedNode('loop')}>
          <Repeat2 />
          {translate('auto.components.agents-workflow.canvas.addLoop', 'Loop')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
