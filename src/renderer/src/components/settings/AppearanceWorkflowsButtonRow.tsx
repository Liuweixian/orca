import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import type { SettingsSearchEntry } from './settings-search'

type AppearanceWorkflowsButtonRowProps = {
  settings: GlobalSettings
  entry: SettingsSearchEntry | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** Why its own module: the appearance pane sits on the 400-line gate and this row shares no state. */
export function AppearanceWorkflowsButtonRow({
  settings,
  entry,
  updateSettings
}: AppearanceWorkflowsButtonRowProps): React.JSX.Element {
  const label = translate(
    'auto.components.settings.AppearancePane.agentsWorkflows',
    'Show Workflows Button'
  )
  const visible = settings.showAgentsWorkflowButton !== false
  return (
    <SearchableSetting
      title={label}
      description={entry?.description}
      keywords={entry?.keywords ?? ['workflow', 'agent', '工作流', 'sidebar']}
    >
      <SettingsSwitchRow
        label={label}
        checked={visible}
        onChange={() => updateSettings({ showAgentsWorkflowButton: !visible })}
      />
    </SearchableSetting>
  )
}
