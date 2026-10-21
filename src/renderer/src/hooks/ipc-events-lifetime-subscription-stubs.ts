/**
 * Stubs for the change feeds `installAppLifetimeIpcEvents` subscribes to.
 *
 * Why a module: several ipc-events test stubs need the same three no-op subscriptions, and one of
 * the harnesses sits on the 300-line gate where three one-liners would not fit.
 */
export const appLifetimeSubscriptionStubs = {
  repos: { onChanged: () => () => {} },
  automations: { onChanged: () => () => {} },
  agentsWorkflows: { onChanged: () => () => {} }
}
