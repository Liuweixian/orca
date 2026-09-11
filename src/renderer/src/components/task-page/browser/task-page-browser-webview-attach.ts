import { ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import {
  moveFocusToRendererBeforeWebviewDetach,
  registerPersistentWebview,
  unregisterPersistentWebview,
  webviewRegistry
} from '@/components/browser-pane/host-guest/webview-registry'

// Why: one stable registry id — the tab shows a single configured page, so no per-mount identity.
export const TASK_PAGE_BROWSER_WEBVIEW_ID = 'task-page-browser'

export function attachTaskPageBrowserWebview({
  container,
  partition,
  url,
  ariaLabel,
  onLoadStarted,
  onLoadStopped,
  onLoadFailed
}: {
  container: HTMLDivElement
  partition: string
  url: string
  ariaLabel: string
  onLoadStarted: () => void
  onLoadStopped: () => void
  onLoadFailed: (event: Electron.DidFailLoadEvent) => void
}): { reload: () => void; detach: () => void } {
  const webview = document.createElement('webview') as Electron.WebviewTag
  // Why no allowpopups: main's popup routing only covers registered browser tabs, so target="_blank"
  // stays denied here instead of falling back to a bare unmanaged Electron window.
  webview.setAttribute('partition', partition)
  webview.setAttribute('webpreferences', ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
  webview.setAttribute('aria-label', ariaLabel)
  // Why: an undeclared canvas paints white while dark surfaces bleed through, making light-on-dark
  // flash and dark text unreadable during load; declare it once for both themes.
  webview.style.backgroundColor = '#fff'
  webview.style.display = 'flex'
  webview.style.width = '100%'
  webview.style.height = '100%'
  webview.style.border = 'none'
  webview.addEventListener('did-start-loading', onLoadStarted)
  webview.addEventListener('did-stop-loading', onLoadStopped)
  webview.addEventListener('did-fail-load', onLoadFailed)
  // Register before append so a guest attached mid-drag cannot swallow the pointer stream.
  registerPersistentWebview(TASK_PAGE_BROWSER_WEBVIEW_ID, webview)
  container.appendChild(webview)
  webview.setAttribute('src', url)

  return {
    reload: () => {
      try {
        webview.reload()
      } catch {
        webview.setAttribute('src', url)
      }
    },
    detach: () => {
      webview.removeEventListener('did-start-loading', onLoadStarted)
      webview.removeEventListener('did-stop-loading', onLoadStopped)
      webview.removeEventListener('did-fail-load', onLoadFailed)
      moveFocusToRendererBeforeWebviewDetach(webview)
      webview.remove()
      if (webviewRegistry.get(TASK_PAGE_BROWSER_WEBVIEW_ID) === webview) {
        unregisterPersistentWebview(TASK_PAGE_BROWSER_WEBVIEW_ID)
      }
    }
  }
}
