import { translateMain } from '../i18n/main-i18n'
import type { KeybindingActionId } from '../../shared/keybindings'
import type { AppearanceMenuKey, AppearanceMenuState } from './register-app-menu'

export type AppMenuAppearanceOptions = {
  appearance: AppearanceMenuState
  shortcutLabel: (actionId: KeybindingActionId) => string
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onToggleAppearance: (key: AppearanceMenuKey) => void
}

// Why its own module: register-app-menu.ts is at the max-lines ceiling, and this submenu is the
// only piece that changes when a sidebar button is added.
export function createAppMenuAppearance(
  options: AppMenuAppearanceOptions
): Electron.MenuItemConstructorOptions {
  const { appearance } = options
  // Why: mirror VS Code's View > Appearance submenu so users can toggle
  // sidebar/status-bar/tasks-button/titlebar-activity from the menu bar as
  // well as from the settings pane. Electron doesn't reactively update
  // menu items when the backing state changes, so rebuildAppMenu() must be
  // called after every settings update — each build reads current
  // appearance state through getAppearanceState() and produces a fresh
  // template with accurate `checked` values.
  return {
    label: translateMain('menu.appearance', 'Appearance'),
    submenu: [
      {
        // Why: display-only shortcut hint — not a real accelerator. Cmd/Ctrl+B
        // is intercepted in createMainWindow.ts's before-input-event handler
        // with a TipTap-bold carve-out for markdown editors. Binding the
        // accelerator here would steal the chord before that carve-out can
        // fire. Sidebar open/closed lives in the renderer store (non-persisted),
        // so we forward a toggle request rather than mirroring state in main.
        label: `${translateMain('menu.toggleLeftSidebar', 'Toggle Left Sidebar')}\t${options.shortcutLabel('sidebar.left.toggle')}`,
        click: () => options.onToggleLeftSidebar()
      },
      {
        // Why: display-only shortcut hint for the same reason as above.
        label: `${translateMain('menu.toggleRightSidebar', 'Toggle Right Sidebar')}\t${options.shortcutLabel('sidebar.right.toggle')}`,
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
}
