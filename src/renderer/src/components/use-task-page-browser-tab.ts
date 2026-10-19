import { useCallback, useState } from 'react'
import type { TaskPageJiraListEffectsModel } from './use-task-page-jira-list-effects'
import {
  TASK_PAGE_BROWSER_NEW_TAB_SELECTION,
  type TaskPageBrowserTabSelection
} from './task-page/browser/task-page-browser-tabs'

export function useTaskPageBrowserTab(model: TaskPageJiraListEffectsModel) {
  const { openTaskPage } = model
  const [taskPageBrowserTabId, setTaskPageBrowserTabId] =
    useState<TaskPageBrowserTabSelection>(null)
  const taskPageBrowserActive = taskPageBrowserTabId !== null
  const openTaskPageBrowserTab = useCallback((tabId: string) => {
    setTaskPageBrowserTabId(tabId)
  }, [])
  const openTaskPageBrowserNewTab = useCallback(() => {
    setTaskPageBrowserTabId(TASK_PAGE_BROWSER_NEW_TAB_SELECTION)
  }, [])
  // Why: every openTaskPage entry point (sidebar, provider icons, worktree cards) targets a task
  // source, so leaving a browser tab selected would show the page over a freshly selected source.
  const openTaskPageLeavingBrowser = useCallback(
    (...args: Parameters<typeof openTaskPage>) => {
      setTaskPageBrowserTabId(null)
      return openTaskPage(...args)
    },
    [openTaskPage]
  )
  const nextModel = model as typeof model & {
    taskPageBrowserActive: boolean
    taskPageBrowserTabId: TaskPageBrowserTabSelection
    openTaskPageBrowserTab: typeof openTaskPageBrowserTab
    openTaskPageBrowserNewTab: typeof openTaskPageBrowserNewTab
    openTaskPage: typeof openTaskPageLeavingBrowser
  }
  nextModel.taskPageBrowserActive = taskPageBrowserActive
  nextModel.taskPageBrowserTabId = taskPageBrowserTabId
  nextModel.openTaskPageBrowserTab = openTaskPageBrowserTab
  nextModel.openTaskPageBrowserNewTab = openTaskPageBrowserNewTab
  nextModel.openTaskPage = openTaskPageLeavingBrowser
  return nextModel
}
export type TaskPageBrowserTabModel = ReturnType<typeof useTaskPageBrowserTab>
