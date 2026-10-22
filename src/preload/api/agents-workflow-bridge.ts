import { ipcRenderer } from 'electron'
import type { AgentsWorkflowsChangedPayload } from '../../shared/runtime-client-events'
import type { PreloadApi } from '../api-types'

export const agentsWorkflowsApi = {
  onChanged: (callback: (payload: AgentsWorkflowsChangedPayload) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: AgentsWorkflowsChangedPayload
    ): void => callback(payload)
    ipcRenderer.on('agentsWorkflows:changed', listener)
    return () => ipcRenderer.removeListener('agentsWorkflows:changed', listener)
  }
} satisfies PreloadApi['agentsWorkflows']
