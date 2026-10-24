/** Saved page for one Tasks-page browser tab. */
export type TaskPageBrowserTab = { id: string; url: string }

/** Settings group for the Tasks page's browser tabs, composed into GlobalSettings. */
export type TaskPageBrowserSettings = {
  /** Saved pages shown as browser tabs in the Tasks page; each entry renders one tab button. */
  taskPageBrowserTabs?: TaskPageBrowserTab[]
}
