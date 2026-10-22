export function agentsWorkflowBackEdgeRoute({
  sourceX,
  sourceY,
  targetX,
  targetY
}: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}): { path: string; labelX: number; labelY: number } {
  const gutterY = Math.max(sourceY, targetY) + 72
  const radius = 16
  const direction = sourceX <= targetX ? 1 : -1
  const sourceTurnX = sourceX + direction * radius
  const targetTurnX = targetX - direction * radius
  return {
    path: [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${gutterY - radius}`,
      `Q ${sourceX} ${gutterY} ${sourceTurnX} ${gutterY}`,
      `L ${targetTurnX} ${gutterY}`,
      `Q ${targetX} ${gutterY} ${targetX} ${gutterY - radius}`,
      `L ${targetX} ${targetY}`
    ].join(' '),
    labelX: (sourceX + targetX) / 2,
    labelY: gutterY
  }
}
