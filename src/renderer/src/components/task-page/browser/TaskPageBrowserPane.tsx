import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ExternalLink, Loader2, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { normalizeExternalBrowserUrl } from '../../../../../shared/browser-url'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { TaskPageBrowserUrlForm } from './TaskPageBrowserUrlForm'
import {
  appendTaskPageBrowserTab,
  createTaskPageBrowserTabId,
  readTaskPageBrowserTabs,
  removeTaskPageBrowserTab,
  TASK_PAGE_BROWSER_NEW_TAB_SELECTION,
  updateTaskPageBrowserTabUrl,
  type TaskPageBrowserTabSelection
} from './task-page-browser-tabs'
import { attachTaskPageBrowserWebview } from './task-page-browser-webview-attach'

type PageState = 'loading' | 'ready' | 'unavailable'
const TASK_PAGE_BROWSER_LOAD_TIMEOUT_MS = 20_000

export function TaskPageBrowserPane({
  selection,
  onSelectTab,
  onStartNewTab
}: {
  selection: Exclude<TaskPageBrowserTabSelection, null>
  onSelectTab: (tabId: string) => void
  onStartNewTab: () => void
}): React.JSX.Element {
  const rawTabs = useAppStore((s) => s.settings?.taskPageBrowserTabs)
  const tabs = readTaskPageBrowserTabs({ taskPageBrowserTabs: rawTabs })
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const reloadRef = useRef<(() => void) | null>(null)
  const [pageState, setPageState] = useState<PageState>('loading')

  const activeTab =
    selection === TASK_PAGE_BROWSER_NEW_TAB_SELECTION
      ? null
      : (tabs.find((tab) => tab.id === selection) ?? null)
  const editing = activeTab !== null && editingTabId === activeTab.id
  // Why: the viewport unmounts while a form is up, so the guest must detach and re-attach when
  // the form toggles — otherwise closing the form leaves an empty container.
  const showForm = activeTab === null || editing
  const url = activeTab?.url ?? ''

  useEffect(() => {
    if (!url || showForm) {
      return
    }
    let disposed = false
    let detachPage: (() => void) | undefined
    let loadFailed = false
    // Why: one load budget from mount — it bounds partition resolution plus the initial page load;
    // later in-page navigations surface through the Reload control instead of a second timer.
    const loadTimeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      loadFailed = true
      setPageState('unavailable')
    }, TASK_PAGE_BROWSER_LOAD_TIMEOUT_MS)
    const clearLoadTimeout = (): void => {
      clearTimeout(loadTimeoutId)
    }
    const onLoadStarted = (): void => {
      loadFailed = false
      setPageState('loading')
    }
    const onLoadStopped = (): void => {
      clearLoadTimeout()
      if (!loadFailed) {
        setPageState('ready')
      }
    }
    const onLoadFailed = (event: Electron.DidFailLoadEvent): void => {
      if (!event.isMainFrame || event.errorCode === -3) {
        return
      }
      clearLoadTimeout()
      loadFailed = true
      setPageState('unavailable')
    }

    setPageState('loading')
    void window.api.browser
      .sessionResolvePartition({ profileId: null })
      .then((partition) => {
        if (disposed || !partition || !containerRef.current) {
          if (!disposed) {
            clearLoadTimeout()
            setPageState('unavailable')
          }
          return
        }
        const attached = attachTaskPageBrowserWebview({
          container: containerRef.current,
          partition,
          url,
          ariaLabel: translate('auto.components.taskPageBrowser.preview', 'Browser page'),
          onLoadStarted,
          onLoadStopped,
          onLoadFailed
        })
        reloadRef.current = attached.reload
        detachPage = attached.detach
      })
      .catch(() => {
        if (!disposed) {
          clearLoadTimeout()
          setPageState('unavailable')
        }
      })

    return () => {
      disposed = true
      clearTimeout(loadTimeoutId)
      reloadRef.current = null
      detachPage?.()
    }
  }, [url, showForm])

  const saveUrl = (nextUrl: string): Promise<void> => {
    if (activeTab) {
      return updateSettings({
        taskPageBrowserTabs: updateTaskPageBrowserTabUrl(tabs, activeTab.id, nextUrl)
      })
    }
    const tabId = createTaskPageBrowserTabId()
    return updateSettings({
      taskPageBrowserTabs: appendTaskPageBrowserTab(tabs, { id: tabId, url: nextUrl })
    }).then(() => onSelectTab(tabId))
  }

  const removeActiveTab = (): void => {
    if (!activeTab) {
      return
    }
    const nextTabs = removeTaskPageBrowserTab(tabs, activeTab.id)
    void updateSettings({ taskPageBrowserTabs: nextTabs })
      .then(() => {
        const [firstRemaining] = nextTabs
        if (firstRemaining) {
          onSelectTab(firstRemaining.id)
        } else {
          onStartNewTab()
        }
      })
      .catch(() => {
        toast.error(
          translate('auto.components.taskPageBrowser.removeFailed', 'Could not remove the tab.')
        )
      })
  }

  if (activeTab === null || editing) {
    return (
      <TaskPageBrowserUrlForm
        initialUrl={url}
        saveUrl={saveUrl}
        onDone={() => setEditingTabId(null)}
        onCancel={activeTab !== null ? () => setEditingTabId(null) : undefined}
      />
    )
  }

  const externalUrl = normalizeExternalBrowserUrl(url)

  return (
    <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div
          className="min-w-0 max-w-[min(420px,40vw)] items-center rounded-md border border-border/50 bg-muted/35 px-2 py-1 text-xs text-muted-foreground"
          title={url}
        >
          <span className="truncate">{url}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('auto.components.taskPageBrowser.reload', 'Reload')}
                onClick={() => reloadRef.current?.()}
              >
                <RotateCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.taskPageBrowser.reload', 'Reload')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('auto.components.taskPageBrowser.editUrl', 'Edit URL')}
                onClick={() => setEditingTabId(activeTab.id)}
              >
                <Pencil className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.taskPageBrowser.editUrl', 'Edit URL')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate(
                  'auto.components.taskPageBrowser.removeTab',
                  'Remove this tab'
                )}
                onClick={removeActiveTab}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.taskPageBrowser.removeTab', 'Remove this tab')}
            </TooltipContent>
          </Tooltip>
          {externalUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.taskPageBrowser.openExternally',
                    'Open in default browser'
                  )}
                  onClick={() => {
                    void window.api.shell.openUrl(externalUrl)
                  }}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate(
                  'auto.components.taskPageBrowser.openExternally',
                  'Open in default browser'
                )}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border/50 bg-editor-surface"
      >
        {pageState === 'loading' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-editor-surface">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {pageState === 'unavailable' ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-editor-surface px-6 text-center">
            <AlertCircle className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {translate('auto.components.taskPageBrowser.unavailableTitle', 'Page unavailable')}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {translate(
                'auto.components.taskPageBrowser.unavailableDescription',
                'The page could not load. Reload, edit the URL, or open it in your default browser.'
              )}
            </p>
            {externalUrl ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void window.api.shell.openUrl(externalUrl)
                }}
              >
                {translate(
                  'auto.components.taskPageBrowser.openExternally',
                  'Open in default browser'
                )}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
