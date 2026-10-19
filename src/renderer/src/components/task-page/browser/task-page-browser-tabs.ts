import type { TaskPageBrowserTab } from '../../../../../shared/global-settings-types'

/** Selection state for the Tasks-page browser strip: a tab id, the add-new-tab flow, or inactive. */
export const TASK_PAGE_BROWSER_NEW_TAB_SELECTION = 'new'
export type TaskPageBrowserTabSelection = string | null

/** Reads the persisted tab list, dropping malformed entries so a bad profile cannot crash the strip. */
export function readTaskPageBrowserTabs(
  settings: { taskPageBrowserTabs?: unknown } | null | undefined
): TaskPageBrowserTab[] {
  const tabs = settings?.taskPageBrowserTabs
  if (!Array.isArray(tabs)) {
    return []
  }
  return tabs.filter(
    (tab): tab is TaskPageBrowserTab =>
      typeof tab?.id === 'string' && typeof tab?.url === 'string' && tab.id !== ''
  )
}

export function createTaskPageBrowserTabId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `task-page-browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  )
}

/** Tab button label: the hostname reads fastest; fall back to the raw URL for file:// and odd input. */
export function getTaskPageBrowserTabLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname !== '' ? hostname : url
  } catch {
    return url
  }
}

export function appendTaskPageBrowserTab(
  tabs: TaskPageBrowserTab[],
  tab: TaskPageBrowserTab
): TaskPageBrowserTab[] {
  return [...tabs, tab]
}

export function updateTaskPageBrowserTabUrl(
  tabs: TaskPageBrowserTab[],
  tabId: string,
  url: string
): TaskPageBrowserTab[] {
  return tabs.map((tab) => (tab.id === tabId ? { ...tab, url } : tab))
}

export function removeTaskPageBrowserTab(
  tabs: TaskPageBrowserTab[],
  tabId: string
): TaskPageBrowserTab[] {
  return tabs.filter((tab) => tab.id !== tabId)
}
