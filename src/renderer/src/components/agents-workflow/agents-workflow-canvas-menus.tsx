import React from 'react'
import { Bot, GitBranch, Repeat2, Trash2, Unplug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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

/** A destructive canvas edit waiting for confirmation; nothing leaves the graph until confirmed. */
export type AgentsWorkflowPendingDelete =
  | { kind: 'nodes'; nodeIds: string[] }
  | { kind: 'edges'; edgeIds: string[] }

/**
 * Asks before a node, a selection, or a connection disappears. Why a dialog rather than an
 * immediate delete: prompt text and edges are gone for good once removed.
 */
export function AgentsWorkflowDeleteConfirmDialog({
  target,
  onCancel,
  onConfirm
}: {
  target: AgentsWorkflowPendingDelete | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.kind === 'nodes'
              ? translate(
                  'auto.components.agents-workflow.canvas.deleteNodesTitle',
                  'Delete selected nodes?'
                )
              : translate(
                  'auto.components.agents-workflow.canvas.deleteEdgeTitle',
                  'Delete this connection?'
                )}
          </DialogTitle>
          <DialogDescription>
            {target?.kind === 'nodes'
              ? translate(
                  'auto.components.agents-workflow.canvas.deleteNodesDescription',
                  'The nodes, their prompts, and every connected edge are removed. This cannot be undone.'
                )
              : translate(
                  'auto.components.agents-workflow.canvas.deleteEdgeDescription',
                  'The two nodes stay, but the run can no longer follow this connection.'
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('auto.components.agents-workflow.canvas.deleteCancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {translate('auto.components.agents-workflow.canvas.deleteConfirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
