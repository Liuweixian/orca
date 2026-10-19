// Why: Codely redacts TOKEN/KEY-named env vars from hook subprocesses by default
// (enableEnvironmentVariableRedaction), stripping ORCA_AGENT_HOOK_TOKEN and
// ORCA_PANE_KEY — the credentials the managed script needs to POST status back.
// Allowlisting Orca's hook variables keeps the redaction on for everything else.
const CODELY_HOOK_ENV_ALLOWLIST = [
  'ORCA_AGENT_HOOK_ENDPOINT',
  'ORCA_AGENT_HOOK_ENV',
  'ORCA_AGENT_HOOK_PORT',
  'ORCA_AGENT_HOOK_TOKEN',
  'ORCA_AGENT_HOOK_TRANSPORT',
  'ORCA_AGENT_HOOK_VERSION',
  'ORCA_AGENT_LAUNCH_TOKEN',
  'ORCA_PANE_KEY',
  'ORCA_TAB_ID',
  'ORCA_WORKTREE_ID'
] as const

export function mergeCodelyHookEnvAllowlist(nextHooks: Record<string, unknown>): void {
  const existing =
    typeof nextHooks.environmentSanitization === 'object' &&
    nextHooks.environmentSanitization !== null
      ? (nextHooks.environmentSanitization as Record<string, unknown>)
      : {}
  const existingAllow = Array.isArray(existing.allowedEnvironmentVariables)
    ? (existing.allowedEnvironmentVariables as unknown[])
    : []
  nextHooks.environmentSanitization = {
    ...existing,
    allowedEnvironmentVariables: Array.from(
      new Set([...existingAllow, ...CODELY_HOOK_ENV_ALLOWLIST])
    )
  }
}

export function removeCodelyHookEnvAllowlist(nextHooks: Record<string, unknown>): void {
  const sanitization = nextHooks.environmentSanitization
  if (
    typeof sanitization !== 'object' ||
    sanitization === null ||
    !Array.isArray((sanitization as Record<string, unknown>).allowedEnvironmentVariables)
  ) {
    return
  }
  const record = sanitization as Record<string, unknown>
  // Why: only entries Orca installed are ORCA_-prefixed; a user's own allowlist entries survive.
  const kept = (record.allowedEnvironmentVariables as unknown[]).filter(
    (entry) => !(typeof entry === 'string' && entry.startsWith('ORCA_'))
  )
  if (kept.length > 0) {
    record.allowedEnvironmentVariables = kept
  } else {
    delete record.allowedEnvironmentVariables
    if (Object.keys(record).length === 0) {
      delete nextHooks.environmentSanitization
    }
  }
}
