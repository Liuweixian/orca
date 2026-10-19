export const AGENTS_WORKFLOW_BINDING_TOKEN = /\{\{binding:([A-Za-z0-9._-]+)\}\}/g

export function agentsWorkflowPromptBindingKeys(source: string): string[] {
  return [...source.matchAll(AGENTS_WORKFLOW_BINDING_TOKEN)].map((match) => match[1] ?? '')
}

export function hasInvalidAgentsWorkflowPromptToken(source: string): boolean {
  const withoutBindings = source.replace(AGENTS_WORKFLOW_BINDING_TOKEN, '')
  return withoutBindings.includes('{{') || withoutBindings.includes('}}')
}
