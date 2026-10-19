import { Globe, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  getTaskPageBrowserTabLabel,
  readTaskPageBrowserTabs,
  type TaskPageBrowserTabSelection
} from './task-page-browser-tabs'

function BrowserStripButton({
  label,
  title,
  active,
  onOpen,
  children
}: {
  label: string
  title?: string
  active: boolean
  onOpen: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          data-task-source="browser"
          title={title}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'group flex h-8 w-8 items-center justify-center rounded-md border transition',
            active
              ? 'border-foreground/40 bg-muted/70 text-foreground shadow-sm'
              : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Tab strip segment of the Tasks source bar: one button per saved page, plus an add-tab button. */
export function TaskPageBrowserTabStrip({
  selection,
  onSelectTab,
  onStartNewTab
}: {
  selection: TaskPageBrowserTabSelection
  onSelectTab: (tabId: string) => void
  onStartNewTab: () => void
}): React.JSX.Element {
  // Why: the selector must return a stable reference — readTaskPageBrowserTabs builds a fresh
  // array per call, and a new-array snapshot makes useSyncExternalStore re-render forever.
  const rawTabs = useAppStore((s) => s.settings?.taskPageBrowserTabs)
  const tabs = readTaskPageBrowserTabs({ taskPageBrowserTabs: rawTabs })
  const addTabLabel = translate('auto.components.taskPageBrowser.addTab', 'Add browser tab')
  return (
    <>
      {tabs.map((tab) => (
        <BrowserStripButton
          key={tab.id}
          label={getTaskPageBrowserTabLabel(tab.url)}
          title={tab.url}
          active={selection === tab.id}
          onOpen={() => onSelectTab(tab.id)}
        >
          <Globe className="size-3.5" />
        </BrowserStripButton>
      ))}
      <BrowserStripButton label={addTabLabel} active={selection === 'new'} onOpen={onStartNewTab}>
        <Plus className="size-3.5" />
      </BrowserStripButton>
    </>
  )
}
