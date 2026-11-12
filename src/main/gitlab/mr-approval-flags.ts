import { parseGlabApiResponse } from './glab-api-response'
import { glabExecFileAsync } from './gl-utils'

type ApprovalGraphResponse = {
  data?: {
    project?: {
      mergeRequests?: {
        nodes?: ({ iid?: string | number; approved?: boolean } | null)[] | null
      } | null
    } | null
  } | null
}

/**
 * The REST merge-request list carries no per-row approval field, so one batched GraphQL call per
 * page answers "approved" for every row at once instead of one `/approvals` request per row.
 */
export async function fetchApprovedMRiids(args: {
  hostArgs: readonly string[]
  execOptions: Parameters<typeof glabExecFileAsync>[1]
  projectPath: string
  iids: readonly number[]
}): Promise<Set<number>> {
  if (args.iids.length === 0) {
    return new Set()
  }
  const query =
    `{ project(fullPath: ${JSON.stringify(args.projectPath)}) {` +
    ` mergeRequests(iids: ${JSON.stringify(args.iids.map(String))}) { nodes { iid approved } } } }`
  try {
    const { stdout } = await glabExecFileAsync(
      ['api', ...args.hostArgs, 'graphql', '-f', `query=${query}`],
      args.execOptions
    )
    const payload = JSON.parse(parseGlabApiResponse(stdout).body) as ApprovalGraphResponse
    const nodes = payload.data?.project?.mergeRequests?.nodes ?? []
    return new Set(
      nodes.flatMap((node) =>
        node?.approved && node.iid !== undefined && node.iid !== null ? [Number(node.iid)] : []
      )
    )
  } catch {
    // Approval styling is decoration; an old schema or a network blip must not fail the whole list.
    return new Set()
  }
}
