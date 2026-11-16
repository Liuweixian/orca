import type { ReactNode } from 'react'
import { toast, type ExternalToast } from 'sonner'
import { translate } from '@/i18n/i18n'

function copyableErrorText(
  message: ReactNode | (() => ReactNode),
  data: ExternalToast | undefined
): string | null {
  if (typeof message !== 'string' || message.trim() === '') {
    return null
  }
  const description = data?.description
  return typeof description === 'string' && description.trim() !== ''
    ? `${message}\n\n${description}`
    : message
}

let copyActionInstalled = false

/** IPC failures read as long unselectable text, so every error toast offers its wording back. */
export function installErrorToastCopyAction(): void {
  if (copyActionInstalled) {
    return
  }
  copyActionInstalled = true
  const showErrorToast = toast.error
  toast.error = (message, data) => {
    const text = copyableErrorText(message, data)
    // Why: a toast has one action slot, and a caller's own choice (retry, settings) is more specific.
    if (text === null || data?.action !== undefined) {
      return showErrorToast(message, data)
    }
    return showErrorToast(message, {
      ...data,
      action: {
        label: translate('menu.copy', 'Copy'),
        onClick: () => void window.api.ui.writeClipboardText(text)
      }
    })
  }
}
