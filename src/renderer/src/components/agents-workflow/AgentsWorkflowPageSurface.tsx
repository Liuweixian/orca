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
  type NodeTypes
} from '@xyflow/react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  availableVariableRefs,
  validateWorkflowDefinition
} from '../../../../shared/agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../../../shared/agents-workflow-types'
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
import {
  toAgentsWorkflowCanvasEdges,
  toAgentsWorkflowCanvasNodes,
  type AgentsWorkflowCanvasNode
} from './agents-workflow-canvas-model'
import { AgentsWorkflowNodeCard } from './agents-workflow-node-card'
import { AgentsWorkflowEdgeComponent } from './agents-workflow-edge'
import { AgentsWorkflowInspector } from './agents-workflow-inspector'
import { AgentsWorkflowTopBar, type AgentsWorkflowNodeKindToAdd } from './agents-workflow-top-bar'
import { AgentsWorkflowDefinitionPanel } from './agents-workflow-definition-panel'
import { AgentsWorkflowRunHistory } from './agents-workflow-run-history'
import type { AgentsWorkflowPageController } from './use-agents-workflow-page-controller'
import './agents-workflow-xyflow-theme.css'

const NODE_TYPES: NodeTypes = { workflow: AgentsWorkflowNodeCard }
const EDGE_TYPES: EdgeTypes = { workflow: AgentsWorkflowEdgeComponent }

function isFromPort(value: string | null | undefined): value is AgentsWorkflowEdge['fromPort'] {
  return (
    value === 'default' || value === 'yes' || value === 'no' || value === 'each' || value === 'done'
  )
}

function isToPort(value: string | null | undefined): value is AgentsWorkflowEdge['toPort'] {
  return value === 'default' || value === 'aggregate'
}

function newNode(kind: AgentsWorkflowNodeKindToAdd, index: number): AgentsWorkflowNode {
  const id = createBrowserUuid()
  const position = { x: 280 + index * 28, y: 120 + index * 28 }
  if (kind === 'agent') {
    return {
      id,
      kind,
      title: translate('auto.components.agents-workflow.newAgent', 'New agent'),
      position,
      agentId: 'claude',
      prompt: { source: '', bindings: {} },
      terminal: false
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      title: translate('auto.components.agents-workflow.newCondition', 'New condition'),
      position,
      input: { kind: 'run_input' },
      operator: 'contains',
      operand: ''
    }
  }
  return {
    id,
    kind,
    title: translate('auto.components.agents-workflow.newLoop', 'New loop'),
    position,
    iteration: { mode: 'fixed', count: 1 }
  }
}

export function AgentsWorkflowPageSurface({
  controller
}: {
  controller: AgentsWorkflowPageController
}): React.JSX.Element {
  const definition = controller.definition
  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        {controller.loading ? (
          <div className="text-sm text-muted-foreground">
            {translate('auto.components.agents-workflow.loading', 'Loading workflows…')}
          </div>
        ) : (
          <Button onClick={() => void controller.createWorkflow()}>
            {translate('auto.components.agents-workflow.createFirst', 'Create workflow')}
          </Button>
        )}
      </div>
    )
  }
  return <AgentsWorkflowLoadedSurface controller={controller} definition={definition} />
}

function AgentsWorkflowLoadedSurface({
  controller,
  definition
}: {
  controller: AgentsWorkflowPageController
  definition: AgentsWorkflowDefinition
}): React.JSX.Element {
  const onDefinitionChange = controller.setDefinition
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const issues = React.useMemo(() => validateWorkflowDefinition(definition), [definition])
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
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedIssues = issues.filter((entry) => entry.nodeId === selectedNodeId)
  const selectedAvailableRefs = selectedNode
    ? availableVariableRefs(definition, selectedNode.id)
    : []

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
          ...definition.edges,
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

  const addNode = React.useCallback(
    (kind: AgentsWorkflowNodeKindToAdd) => {
      const created = newNode(kind, definition.nodes.length)
      onDefinitionChange({
        ...definition,
        nodes: [...definition.nodes, created],
        updatedAt: Date.now()
      })
      setSelectedNodeId(created.id)
    },
    [definition, onDefinitionChange]
  )

  const deleteNodes = React.useCallback(
    (deleted: AgentsWorkflowCanvasNode[]) => {
      const deletedIds = new Set(
        deleted.filter((entry) => entry.data.workflowNode.kind !== 'start').map((entry) => entry.id)
      )
      if (deletedIds.size === 0) {
        return
      }
      onDefinitionChange({
        ...definition,
        nodes: definition.nodes.filter((node) => !deletedIds.has(node.id)),
        edges: definition.edges.filter(
          (edge) => !deletedIds.has(edge.fromNodeId) && !deletedIds.has(edge.toNodeId)
        ),
        updatedAt: Date.now()
      })
      setSelectedNodeId((current) => (current && deletedIds.has(current) ? null : current))
    },
    [definition, onDefinitionChange]
  )

  const exportDefinition = React.useCallback(() => {
    void navigator.clipboard
      .writeText(JSON.stringify(definition, null, 2))
      .then(() =>
        toast.success(
          translate('auto.components.agents-workflow.exported', 'Workflow JSON copied.')
        )
      )
      .catch(() =>
        toast.error(
          translate('auto.components.agents-workflow.exportFailed', 'Could not copy workflow JSON.')
        )
      )
  }, [definition])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentsWorkflowTopBar
        name={definition.name}
        errorCount={issues.filter((entry) => entry.severity === 'error').length}
        dirty={controller.dirty}
        saving={controller.saving}
        running={controller.running}
        runInput={controller.runInput}
        onAddNode={addNode}
        onSave={() => void controller.saveWorkflow()}
        onDelete={() => setDeleteOpen(true)}
        onRunInputChange={controller.setRunInput}
        onRun={() => void controller.runNow()}
        onExport={exportDefinition}
      />
      {controller.conflict ? (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span>
            {translate(
              'auto.components.agents-workflow.conflict',
              'This workflow changed in another window. Reload it before saving.'
            )}
          </span>
          <Button variant="outline" size="xs" onClick={() => void controller.reloadAfterConflict()}>
            {translate('auto.components.agents-workflow.reload', 'Reload')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <AgentsWorkflowDefinitionPanel
          workflows={controller.workflows}
          definition={definition}
          onSelect={(id) => void controller.selectWorkflow(id)}
          onCreate={() => void controller.createWorkflow()}
          onChange={onDefinitionChange}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="agents-workflow-canvas min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onNodesDelete={deleteNodes}
              onEdgesDelete={(deleted) =>
                onDefinitionChange({
                  ...definition,
                  edges: definition.edges.filter(
                    (edge) => !deleted.some((entry) => entry.id === edge.id)
                  ),
                  updatedAt: Date.now()
                })
              }
              onConnect={onConnect}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
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
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              selectionOnDrag
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              <Controls />
              {/* Why muted-foreground: --muted is near-invisible against the card minimap background in light mode. */}
              <MiniMap pannable zoomable nodeColor="var(--muted-foreground)" />
            </ReactFlow>
          </div>
          <AgentsWorkflowRunHistory
            runs={controller.runs}
            selectedRun={controller.selectedRun}
            hasMore={controller.nextRunsCursor !== null}
            onSelect={(runId) => void controller.selectRun(runId)}
            onLoadMore={() => void controller.loadMoreRuns()}
            onCancel={(runId) => void controller.cancelRun(runId)}
          />
        </div>
        <AgentsWorkflowInspector
          node={selectedNode}
          issues={selectedIssues}
          definition={definition}
          availableRefs={selectedAvailableRefs}
          onChange={(updated) =>
            onDefinitionChange({
              ...definition,
              nodes: definition.nodes.map((node) => (node.id === updated.id ? updated : node)),
              updatedAt: Date.now()
            })
          }
        />
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.agents-workflow.delete.title', 'Delete workflow?')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.agents-workflow.delete.description',
                'Run history remains available until retention removes it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {translate('auto.components.agents-workflow.delete.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false)
                void controller.deleteWorkflow()
              }}
            >
              {translate('auto.components.agents-workflow.delete.confirm', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
