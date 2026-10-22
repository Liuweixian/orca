// Why this exists: workflows and runs written before the editor dropped variables still carry
// `trigger.defaultInput`, prompt bindings, `{{binding:…}}` tokens, condition operators and loop
// `iteration` objects. The current schemas are strict, so parsing those records unchanged drops
// them — migration rewrites the legacy shape before validation instead of losing the user's data.

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
    return { ...value, prompt: migratePrompt(value.prompt) }
  }
  if (value.kind === 'condition') {
    const { input: _input, operator: _operator, operand: _operand, ...rest } = value
    return {
      ...rest,
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

export function migrateLegacyAgentsWorkflowDefinition(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const trigger = isRecord(value.trigger)
    ? Object.fromEntries(Object.entries(value.trigger).filter(([key]) => key !== 'defaultInput'))
    : value.trigger
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(migrateNode) : value.nodes
  return { ...value, nodes, trigger }
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
