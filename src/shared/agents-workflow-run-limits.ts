// The size and retention ceilings of agent workflow run history.
//
// One module because these numbers only make sense together: a single node's answer, one run's
// total, the evidence kept per stored attempt, and how many runs survive. Tuning one in isolation
// silently changes the storage worst case, so they are greppable from a single place.

/** The largest answer one node may produce and still be trusted as a value. */
export const AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES = 1024 * 1024

/** The largest total node output one run may capture before it fails. */
export const AGENTS_WORKFLOW_RUN_OUTPUT_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * What a stored attempt keeps of its answer. Why separate from the capture limit: the full text
 * already went to the next node's handoff file, and run history only needs enough of it to explain
 * what happened. Without this a 100-run history could hold gigabytes of copies.
 */
export const AGENTS_WORKFLOW_TERMINAL_ATTEMPT_OUTPUT_LIMIT_BYTES = 8 * 1024

/** How many finished runs one workflow keeps before the oldest are pruned. */
export const TERMINAL_RUN_RETENTION_PER_WORKFLOW = 100
