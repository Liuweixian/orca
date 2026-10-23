import React from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance
} from '@xyflow/react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AgentsWorkflowValidationIssue } from '../../../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowNode
} from '../../../../shared/agents-workflow-types'
import { translate } from '@/i18n/i18n'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  toAgentsWorkflowCanvasEdges,
  toAgentsWorkflowCanvasNodes,
  type AgentsWorkflowCanvasEdge,
  type AgentsWorkflowCanvasNode
} from './agents-workflow-canvas-model'
import { AgentsWorkflowNodeCard } from './agents-workflow-node-card'
import { AgentsWorkflowEdgeComponent } from './agents-workflow-edge'
import {
  AgentsWorkflowConnectionDropMenu,
  AgentsWorkflowCanvasContextMenu,
  AgentsWorkflowDeleteConfirmDialog,
  type AgentsWorkflowConnectionDrop,
  type AgentsWorkflowPendingDelete
} from './agents-workflow-canvas-menus'
import {
  CANVAS_SNAP_GRID,
  isFromPort,
  isToPort,
  newNode,
  type AgentsWorkflowNodeKindToAdd
} from './agents-workflow-node-factory'
import './agents-workflow-xyflow-theme.css'

const NODE_TYPES: NodeTypes = { workflow: AgentsWorkflowNodeCard }
const EDGE_TYPES: EdgeTypes = { workflow: AgentsWorkflowEdgeComponent }

export function AgentsWorkflowCanvas({
  definition,
  issues,
  onDefinitionChange,
  onSelectNode,
  onNodesRemoved
}: {
  definition: AgentsWorkflowDefinition
  issues: readonly AgentsWorkflowValidationIssue[]
  onDefinitionChange: (definition: AgentsWorkflowDefinition) => void
  onSelectNode: (nodeId: string | null) => void
  onNodesRemoved: (ids: Set<string>) => void
}): React.JSX.Element {
  const flowInstanceRef = React.useRef<ReactFlowInstance<
    AgentsWorkflowCanvasNode,
    AgentsWorkflowCanvasEdge
  > | null>(null)
  const contextMenuScreenPositionRef = React.useRef<{ x: number; y: number } | null>(null)
  const [nodeMenuTargetId, setNodeMenuTargetId] = React.useState<string | null>(null)
  const [edgeMenuTargetId, setEdgeMenuTargetId] = React.useState<string | null>(null)
  const [connectionDropTarget, setConnectionDropTarget] =
    React.useState<AgentsWorkflowConnectionDrop | null>(null)
  /** A destructive edit waiting for confirmation; nothing leaves the graph until it is confirmed. */
  const [pendingDelete, setPendingDelete] = React.useState<AgentsWorkflowPendingDelete | null>(null)
  const derivedNodes = React.useMemo(
    () => toAgentsWorkflowCanvasNodes(definition, issues),
    [definition, issues]
  )
  const [nodes, setNodes] = React.useState(derivedNodes)
  const [renderedNodes, setRenderedNodes] = React.useState(derivedNodes)
  if (renderedNodes !== derivedNodes) {
    setRenderedNodes(derivedNodes)
    setNodes((current) =>
      derivedNodes.map((node) => {
        const existing = current.find((entry) => entry.id === node.id)
        return existing
          ? { ...node, measured: existing.measured, width: existing.width, height: existing.height }
          : node
      })
    )
  }
  const edges = React.useMemo(() => toAgentsWorkflowCanvasEdges(definition), [definition])
  const nodeMenuNode = nodeMenuTargetId
    ? (definition.nodes.find((node) => node.id === nodeMenuTargetId) ?? null)
    : null

  const onNodesChange = React.useCallback(
    (changes: NodeChange<AgentsWorkflowCanvasNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current))
      const positions = new Map(
        changes.flatMap((change) =>
          change.type === 'position' && change.position && change.dragging !== true
            ? [[change.id, change.position]]
            : []
        )
      )
      if (positions.size === 0) {
        return
      }
      onDefinitionChange({
        ...definition,
        nodes: definition.nodes.map((node) => {
          const position = positions.get(node.id)
          return position ? { ...node, position } : node
        }),
        updatedAt: Date.now()
      })
    },
    [definition, onDefinitionChange]
  )

  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !isFromPort(connection.sourceHandle) ||
        !isToPort(connection.targetHandle)
      ) {
        return
      }
      onDefinitionChange({
        ...definition,
        edges: [
          // Why filter: a port has one outgoing edge, so connecting replaces the old target
          // instead of leaving an extra edge the canvas shows but validation rejects.
          ...definition.edges.filter(
            (edge) =>
              !(edge.fromNodeId === connection.source && edge.fromPort === connection.sourceHandle)
          ),
          {
            id: createBrowserUuid(),
            fromNodeId: connection.source,
            toNodeId: connection.target,
            fromPort: connection.sourceHandle,
            toPort: connection.targetHandle
          }
        ],
        updatedAt: Date.now()
      })
    },
    [definition, onDefinitionChange]
  )

  const resolveNodePosition = React.useCallback(
    (screen: { x: number; y: number } | null): AgentsWorkflowNode['position'] =>
      (screen
        ? flowInstanceRef.current?.screenToFlowPosition(screen, {
            snapToGrid: true,
            snapGrid: CANVAS_SNAP_GRID
          })
        : undefined) ?? {
        x: 280 + definition.nodes.length * 28,
        y: 120 + definition.nodes.length * 28
      },
    [definition.nodes.length]
  )

  const addNode = React.useCallback(
    (kind: AgentsWorkflowNodeKindToAdd, screenPosition: { x: number; y: number } | null) => {
      const created = newNode(kind, resolveNodePosition(screenPosition))
      onDefinitionChange({
        ...definition,
        nodes: [...definition.nodes, created],
        updatedAt: Date.now()
      })
      onSelectNode(created.id)
    },
    [definition, onDefinitionChange, onSelectNode, resolveNodePosition]
  )

  const addConnectedNode = React.useCallback(
    (kind: AgentsWorkflowNodeKindToAdd) => {
      const drop = connectionDropTarget
      if (!drop) {
        return
      }
      const created = newNode(kind, resolveNodePosition(drop.screen))
      onDefinitionChange({
        ...definition,
        nodes: [...definition.nodes, created],
        edges: [
          // Why filter: the dragged port gets exactly one outgoing edge — the new node replaces its previous target.
          ...definition.edges.filter(
            (edge) => !(edge.fromNodeId === drop.fromNodeId && edge.fromPort === drop.fromPort)
          ),
          {
            id: createBrowserUuid(),
            fromNodeId: drop.fromNodeId,
            toNodeId: created.id,
            fromPort: drop.fromPort,
            toPort: 'default'
          }
        ],
        updatedAt: Date.now()
      })
      onSelectNode(created.id)
      setConnectionDropTarget(null)
    },
    [connectionDropTarget, definition, onDefinitionChange, onSelectNode, resolveNodePosition]
  )

  const onCanvasContextMenu = React.useCallback((event: React.MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const nodeElement = target?.closest('.react-flow__node') ?? null
    if (nodeElement) {
      setNodeMenuTargetId(nodeElement.getAttribute('data-id'))
      setEdgeMenuTargetId(null)
      return
    }
    const edgeElement = target?.closest('.react-flow__edge') ?? null
    setNodeMenuTargetId(null)
    setEdgeMenuTargetId(edgeElement?.getAttribute('data-id') ?? null)
    // Why preventDefault only on panels: the context menu trigger opens on the
    // bubble phase, so preventing the native menu everywhere else would cancel it.
    if (target?.closest('.react-flow__panel')) {
      event.preventDefault()
    }
    contextMenuScreenPositionRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const removeNodeIds = React.useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) {
        return
      }
      onDefinitionChange({
        ...definition,
        nodes: definition.nodes.filter((node) => !ids.has(node.id)),
        edges: definition.edges.filter(
          (edge) => !ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId)
        ),
        updatedAt: Date.now()
      })
      onNodesRemoved(ids)
    },
    [definition, onDefinitionChange, onNodesRemoved]
  )

  const resyncNodes = React.useCallback(() => {
    setNodes((current) =>
      derivedNodes.map((node) => {
        const existing = current.find((entry) => entry.id === node.id)
        return existing
          ? { ...node, measured: existing.measured, width: existing.width, height: existing.height }
          : node
      })
    )
  }, [derivedNodes])

  const requestNodeDeletion = React.useCallback(
    (ids: string[]) => {
      // Start and end are structural: deleting either would leave the graph without a boundary.
      const deletable = ids.filter((id) => {
        const kind = definition.nodes.find((node) => node.id === id)?.kind
        return kind !== 'start' && kind !== 'end'
      })
      if (deletable.length === 0) {
        // React Flow already removed the node locally; put it back when nothing may be deleted.
        resyncNodes()
        return
      }
      setPendingDelete({ kind: 'nodes', nodeIds: deletable })
    },
    [definition.nodes, resyncNodes]
  )

  const requestEdgeDeletion = React.useCallback(
    (ids: string[]) => {
      const deletable = ids.filter((id) => definition.edges.some((edge) => edge.id === id))
      if (deletable.length > 0) {
        setPendingDelete({ kind: 'edges', edgeIds: deletable })
      }
    },
    [definition.edges]
  )

  const confirmPendingDelete = React.useCallback(() => {
    if (!pendingDelete) {
      return
    }
    if (pendingDelete.kind === 'nodes') {
      removeNodeIds(new Set(pendingDelete.nodeIds))
    } else {
      const ids = new Set(pendingDelete.edgeIds)
      onDefinitionChange({
        ...definition,
        edges: definition.edges.filter((edge) => !ids.has(edge.id)),
        updatedAt: Date.now()
      })
    }
    setPendingDelete(null)
  }, [definition, onDefinitionChange, pendingDelete, removeNodeIds])

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) {
            setNodeMenuTargetId(null)
            setEdgeMenuTargetId(null)
          }
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            className="agents-workflow-canvas min-h-0 flex-1"
            onContextMenu={onCanvasContextMenu}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onNodesDelete={(deleted) => requestNodeDeletion(deleted.map((entry) => entry.id))}
              onEdgesDelete={(deleted) => requestEdgeDeletion(deleted.map((entry) => entry.id))}
              onConnect={onConnect}
              onConnectEnd={(event, connectionState) => {
                if (connectionState.isValid === false && connectionState.toHandle) {
                  // Why toast: a rejected drop (duplicate edge, self-loop, wrong handle side)
                  // is otherwise silent and reads as "dragging connections is broken".
                  toast.warning(
                    translate(
                      'auto.components.agents-workflow.canvas.connectionRejected',
                      'Connection not created: these ports are already linked or cannot be connected.'
                    )
                  )
                  return
                }
                if (
                  !connectionState.fromHandle ||
                  connectionState.toHandle !== null ||
                  connectionState.isValid !== null ||
                  !('clientX' in event) ||
                  !isFromPort(connectionState.fromHandle.id)
                ) {
                  return
                }
                // Released over bare canvas while dragging from a handle: offer to
                // create a node at the release point, auto-connected to this port.
                setConnectionDropTarget({
                  screen: { x: event.clientX, y: event.clientY },
                  fromNodeId: connectionState.fromHandle.nodeId,
                  fromPort: connectionState.fromHandle.id
                })
              }}
              onNodeClick={(_event, node) => onSelectNode(node.id)}
              onPaneClick={() => onSelectNode(null)}
              onInit={(instance) => {
                flowInstanceRef.current = instance
              }}
              isValidConnection={(connection) =>
                connection.source !== connection.target &&
                !definition.edges.some(
                  (edge) =>
                    edge.fromNodeId === connection.source &&
                    edge.toNodeId === connection.target &&
                    edge.fromPort === connection.sourceHandle &&
                    edge.toPort === connection.targetHandle
                )
              }
              proOptions={{ hideAttribution: true }}
              fitView
              snapToGrid
              snapGrid={CANVAS_SNAP_GRID}
              selectionOnDrag
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              <Controls />
              {/* Why muted-foreground: --muted is near-invisible against the card minimap background in light mode. */}
              <MiniMap pannable zoomable nodeColor="var(--muted-foreground)" />
            </ReactFlow>
          </div>
        </ContextMenuTrigger>
        <AgentsWorkflowCanvasContextMenu
          nodeMenuNode={nodeMenuNode}
          edgeMenuId={edgeMenuTargetId}
          onAddNode={(kind) => addNode(kind, contextMenuScreenPositionRef.current)}
          onDeleteNode={(id) => requestNodeDeletion([id])}
          onDeleteEdge={(id) => requestEdgeDeletion([id])}
        />
      </ContextMenu>
      <AgentsWorkflowConnectionDropMenu
        dropTarget={connectionDropTarget}
        onCreateConnectedNode={addConnectedNode}
        onDismiss={() => setConnectionDropTarget(null)}
      />
      <AgentsWorkflowDeleteConfirmDialog
        target={pendingDelete}
        onCancel={() => {
          // Why resync: React Flow already applied the keyboard delete locally; cancelling must
          // put the nodes back, not leave the canvas missing nodes the definition still has.
          resyncNodes()
          setPendingDelete(null)
        }}
        onConfirm={confirmPendingDelete}
      />
    </>
  )
}
