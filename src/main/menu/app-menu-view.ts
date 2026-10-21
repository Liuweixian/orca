import type { KeybindingActionId } from '../../shared/keybindings'
import { translateMain } from '../i18n/main-i18n'

export type AppearanceMenuState = {
  showTasksButton: boolean
  showAutomationsButton: boolean
  showAgentsWorkflowButton: boolean
  showMobileButton: boolean
  showTitlebarAppName: boolean
  statusBarVisible: boolean
}

export type AppearanceMenuKey = keyof AppearanceMenuState

export type AppMenuViewOptions = {
  appearance: AppearanceMenuState
  shortcutLabel: (actionId: KeybindingActionId) => string
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onToggleAppearance: (key: AppearanceMenuKey) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  reloadFocusedWindow: (ignoreCache: boolean) => void
}

/** View > Appearance, plus the View menu that holds it. */
export function createAppMenuView(
  options: AppMenuViewOptions
): Electron.MenuItemConstructorOptions {
  const { appearance, shortcutLabel } = options
  // Why: mirror VS Code's View > Appearance submenu so users can toggle
  // sidebar/status-bar/tasks-button/titlebar-activity from the menu bar as
  // well as from the settings pane. Electron doesn't reactively update
  // menu items when the backing state changes, so rebuildAppMenu() must be
  // called after every settings update — each build reads current
  // appearance state through getAppearanceState() and produces a fresh
  // template with accurate `checked` values.
  const appearanceSubmenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.appearance', 'Appearance'),
    submenu: [
      {
        // Why: display-only shortcut hint — not a real accelerator. Cmd/Ctrl+B
        // is intercepted in createMainWindow.ts's before-input-event handler
        // with a TipTap-bold carve-out for markdown editors. Binding the
        // accelerator here would steal the chord before that carve-out can
        // fire. Sidebar open/closed lives in the renderer store (non-persisted),
        // so we forward a toggle request rather than mirroring state in main.
        label: `${translateMain('menu.toggleLeftSidebar', 'Toggle Left Sidebar')}\t${shortcutLabel('sidebar.left.toggle')}`,
        click: () => options.onToggleLeftSidebar()
      },
      {
        // Why: display-only shortcut hint for the same reason as above.
        label: `${translateMain('menu.toggleRightSidebar', 'Toggle Right Sidebar')}\t${shortcutLabel('sidebar.right.toggle')}`,
        click: () => options.onToggleRightSidebar()
      },
      {
        label: translateMain('menu.showStatusBar', 'Show Status Bar'),
        type: 'checkbox',
        checked: appearance.statusBarVisible,
        click: () => options.onToggleAppearance('statusBarVisible')
      },
      { type: 'separator' },
      {
        label: translateMain('menu.showTasksButton', 'Show Tasks Button'),
        type: 'checkbox',
        checked: appearance.showTasksButton,
        click: () => options.onToggleAppearance('showTasksButton')
      },
      {
        label: translateMain('menu.showAutomationsButton', 'Show Automations Button'),
        type: 'checkbox',
        checked: appearance.showAutomationsButton,
        click: () => options.onToggleAppearance('showAutomationsButton')
      },
      {
        label: translateMain('menu.showAgentsWorkflowButton', 'Show Workflows Button'),
        type: 'checkbox',
        checked: appearance.showAgentsWorkflowButton,
        click: () => options.onToggleAppearance('showAgentsWorkflowButton')
      },
      {
        label: translateMain('menu.showMobileButton', 'Show Orca Mobile Button'),
        type: 'checkbox',
        checked: appearance.showMobileButton,
        click: () => options.onToggleAppearance('showMobileButton')
      },
      {
        label: translateMain('menu.showTitlebarAppName', 'Show Titlebar App Name'),
        type: 'checkbox',
        checked: appearance.showTitlebarAppName,
        click: () => options.onToggleAppearance('showTitlebarAppName')
      }
    ]
  }

  return {
    label: translateMain('menu.view', 'View'),
    submenu: [
      {
        label: translateMain('menu.reload', 'Reload'),
        click: () => options.reloadFocusedWindow(false)
      },
      {
        label: `${translateMain('menu.forceReload', 'Force Reload')}\t${shortcutLabel('app.forceReload')}`,
        click: () => options.reloadFocusedWindow(true)
      },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: `${translateMain('menu.resetSize', 'Reset Size')}\t${shortcutLabel('zoom.reset')}`,
        click: () => options.onZoomReset()
      },
      {
        label: `${translateMain('menu.zoomIn', 'Zoom In')}\t${shortcutLabel('zoom.in')}`,
        click: () => options.onZoomIn()
      },
      {
        label: `${translateMain('menu.zoomOut', 'Zoom Out')}\t${shortcutLabel('zoom.out')}`,
        click: () => options.onZoomOut()
      },
      { type: 'separator' },
      {
        // Why: display-only shortcut hint — do NOT set `accelerator` here.
        // Menu accelerators intercept key events at the main-process level
        // before the renderer's keydown handler fires. The overlay
        // mutual-exclusion logic (which runs in the renderer) would be
        // bypassed if this were a real accelerator binding.
        label: `${translateMain('menu.openWorktreePalette', 'Open Worktree Palette')}\t${shortcutLabel('worktree.palette')}`
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      appearanceSubmenu
    ]
  }
}
