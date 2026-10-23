// Why this exists: workflows and runs written before the editor dropped variables still carry
// `trigger.defaultInput`, prompt bindings, `{{binding:…}}` tokens, condition operators and loop
// `iteration` objects. Nodes also used to carry `extraAgentArgs`, which the editor no longer
// offers, and agent nodes carried a `terminal` flag that the explicit end node now replaces. The
// current schemas are strict, so parsing those records unchanged drops them — migration rewrites
// the legacy shape before validation instead of losing the user's data.

const LEGACY_BINDING_TOKEN = /\{\{binding:([A-Za-z0-9._-]+)\}\}/g

const LEGACY_CONDITION_PHRASES: Record<string, string> = {
  contains: 'whether it contains the text the author expected',
  not_contains: 'whether it avoids the text the author expected',
  empty: 'whether it is empty',
  not_empty: 'whether it is not empty',
  length_gte: 'whether it is at least the expected length'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function legacyConditionPrompt(value: Record<string, unknown>): string {
  const phrase =
    (typeof value.operator === 'string' ? LEGACY_CONDITION_PHRASES[value.operator] : undefined) ??
    'whether the condition holds'
  const operand = typeof value.operand === 'string' && value.operand ? ` "${value.operand}"` : ''
  return `Read the answer this node inherits and decide ${phrase}${operand}. Answer with {"decision":"yes"} or {"decision":"no"}.`
}

/** Drops the binding records and the tokens that referred to them; the text itself stays. */
function migratePrompt(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  if (!('bindings' in value)) {
    return value
  }
  const { bindings: _bindings, ...rest } = value
  const source = typeof rest.source === 'string' ? rest.source : ''
  return { ...rest, source: source.replace(LEGACY_BINDING_TOKEN, '') }
}

function migrateNode(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  if (value.kind === 'agent') {
    // `terminal` went away with the toggle: the graph derives it from whether an edge leaves.
    const { extraAgentArgs: _extraAgentArgs, terminal: _terminal, ...rest } = value
    return { ...rest, prompt: migratePrompt(rest.prompt) }
  }
  if (value.kind === 'condition') {
    const { input: _input, operator: _operator, operand: _operand, ...rest } = value
    const { extraAgentArgs: _extraAgentArgs, ...withoutExtraAgentArgs } = rest
    return {
      ...withoutExtraAgentArgs,
      agentId: typeof rest.agentId === 'string' && rest.agentId ? rest.agentId : 'claude',
      prompt: isRecord(rest.prompt)
        ? migratePrompt(rest.prompt)
        : { source: legacyConditionPrompt(value) }
    }
  }
  if (value.kind === 'loop') {
    const { iteration, count, ...rest } = value
    if (typeof count === 'number') {
      return value
    }
    // A list-driven loop had no other source than a variable, so it becomes one fixed turn.
    const legacyCount =
      isRecord(iteration) && typeof iteration.count === 'number' ? iteration.count : 1
    return { ...rest, count: Math.min(20, Math.max(1, Math.trunc(legacyCount))) }
  }
  return value
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${suffix}`
  }
  taken.add(id)
  return id
}

/**
 * End used to be derived from "no edge leaves this node". The graph now makes it explicit, so a
 * definition saved before that change would fail `end_count` — and a scheduled workflow would then
 * be skipped silently on every tick. Adds the node and connects the sinks that have a single
 * outgoing port; conditions and loops keep their named branches for the author to wire.
 */
function withEndNode(value: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(value.nodes) ? value.nodes : null
  const rawEdges = Array.isArray(value.edges) ? value.edges : null
  if (!nodes || !rawEdges || nodes.some((node) => isRecord(node) && node.kind === 'end')) {
    return value
  }
  const edges = rawEdges.filter(isRecord)
  const takenIds = new Set<string>([
    ...nodes.flatMap((node) => (isRecord(node) && typeof node.id === 'string' ? [node.id] : [])),
    ...edges.flatMap((edge) => (typeof edge.id === 'string' ? [edge.id] : []))
  ])
  const endId = uniqueId('end', takenIds)
  const sources = new Set(
    edges.flatMap((edge) => (typeof edge.fromNodeId === 'string' ? [edge.fromNodeId] : []))
  )
  // Why place it after a sink: the canvas uses absolute coordinates, so a new end node at the
  // origin would sit on top of Start.
  const sinkPosition = nodes
    .map((node) => (isRecord(node) ? node : null))
    .find(
      (node) =>
        node !== null &&
        typeof node.id === 'string' &&
        (node.kind === 'start' || node.kind === 'agent' || node.kind === 'command') &&
        !sources.has(node.id)
    )?.position
  const end = {
    id: endId,
    kind: 'end',
    title: 'End',
    position:
      isRecord(sinkPosition) &&
      typeof sinkPosition.x === 'number' &&
      typeof sinkPosition.y === 'number'
        ? { x: sinkPosition.x + 240, y: sinkPosition.y }
        : { x: 0, y: 0 }
  }
  const boundaryEdges = nodes.flatMap((node) => {
    if (
      !isRecord(node) ||
      typeof node.id !== 'string' ||
      (node.kind !== 'start' && node.kind !== 'agent' && node.kind !== 'command') ||
      sources.has(node.id)
    ) {
      return []
    }
    return [
      {
        id: uniqueId(`end-edge-${node.id}`, takenIds),
        fromNodeId: node.id,
        toNodeId: endId,
        fromPort: 'default',
        toPort: 'default'
      }
    ]
  })
  return { ...value, nodes: [...nodes, end], edges: [...edges, ...boundaryEdges] }
}

export function migrateLegacyAgentsWorkflowDefinition(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const trigger = isRecord(value.trigger)
    ? Object.fromEntries(Object.entries(value.trigger).filter(([key]) => key !== 'defaultInput'))
    : value.trigger
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(migrateNode) : value.nodes
  return withEndNode({ ...value, nodes, trigger })
}

export function migrateLegacyAgentsWorkflowRun(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const { input: _input, ...rest } = value
  return {
    ...rest,
    definitionSnapshot: migrateLegacyAgentsWorkflowDefinition(value.definitionSnapshot)
  }
}
