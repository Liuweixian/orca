import { normalizeBrowserNavigationUrl } from '../../../../../shared/browser-url'
import { ORCA_BROWSER_BLANK_URL } from '../../../../../shared/constants'

/** Normalizes a user-configured Tasks browser tab URL; rejects blank and non-navigable input. */
export function resolveTaskPageBrowserUrl(rawUrl: string): string | null {
  const normalized = normalizeBrowserNavigationUrl(rawUrl)
  return normalized === null || normalized === ORCA_BROWSER_BLANK_URL ? null : normalized
}
