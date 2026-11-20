import {
  AGY_AGENT_NAME_RE,
  DROID_AGENT_NAME_RE,
  HERMES_AGENT_NAME_RE,
  titleHasAgentName
} from './agent-name-token-match'
import { STRONG_PERMISSION_KEYWORDS_RE, containsLegacyAgentName } from './agent-title-core'
import { getWrapperTitleSegments } from './terminal-title-wrapper-segments'

/** A wrapped permission title names an agent and a strong permission keyword in the same segment. */
export function hasPermissionTitleSegment(title: string): boolean {
  return getWrapperTitleSegments(title).some(
    (segment) =>
      !AGY_AGENT_NAME_RE.test(segment) &&
      !titleHasAgentName(segment, 'antigravity') &&
      (containsLegacyAgentName(segment) ||
        DROID_AGENT_NAME_RE.test(segment) ||
        HERMES_AGENT_NAME_RE.test(segment)) &&
      STRONG_PERMISSION_KEYWORDS_RE.test(segment)
  )
}
