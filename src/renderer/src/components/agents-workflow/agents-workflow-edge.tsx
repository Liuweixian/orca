import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentsWorkflowCanvasEdge } from './agents-workflow-canvas-model'
import { agentsWorkflowBackEdgeRoute } from './agents-workflow-back-edge-route'

function portLabel(port: string): string | null {
  switch (port) {
    case 'yes':
      return translate('auto.components.agents-workflow.edge.yes', 'Yes')
    case 'no':
      return translate('auto.components.agents-workflow.edge.no', 'No')
    case 'each':
      return translate('auto.components.agents-workflow.edge.each', 'Each')
    case 'done':
      return translate('auto.components.agents-workflow.edge.done', 'Done')
    default:
      return null
  }
}

export function AgentsWorkflowEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data
}: EdgeProps<AgentsWorkflowCanvasEdge>): React.JSX.Element {
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })
  const workflowEdge = data?.workflowEdge
  const aggregate = workflowEdge?.toPort === 'aggregate'
  const aggregateRoute = aggregate
    ? agentsWorkflowBackEdgeRoute({ sourceX, sourceY, targetX, targetY })
    : null
  const path = aggregateRoute?.path ?? bezierPath
  const labelX = aggregateRoute?.labelX ?? bezierLabelX
  const labelY = aggregateRoute?.labelY ?? bezierLabelY
  const label = workflowEdge ? portLabel(workflowEdge.fromPort) : null
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        className={cn('stroke-border', aggregate && 'agents-workflow-edge-aggregate')}
      />
      {label ? (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute rounded-full border border-border bg-background px-1.5 py-0.5 text-3xs font-semibold text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
