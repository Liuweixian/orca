import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { resolveTaskPageBrowserUrl } from './task-page-browser-url'

export function TaskPageBrowserUrlForm({
  initialUrl,
  saveUrl,
  onDone,
  onCancel
}: {
  initialUrl: string
  /** Persists the validated URL; rejecting surfaces the failure toast. */
  saveUrl: (url: string) => Promise<void>
  /** Called after a successful save (closes the form and returns to the page view). */
  onDone: () => void
  /** Omitted when there is nothing to go back to (first tab, add-new flow). */
  onCancel?: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(initialUrl)
  const [saving, setSaving] = useState(false)

  const save = (): void => {
    const normalized = resolveTaskPageBrowserUrl(draft)
    if (!normalized) {
      toast.error(
        translate(
          'auto.components.taskPageBrowser.invalidUrl',
          'Enter a valid URL, e.g. https://example.com.'
        )
      )
      return
    }
    setSaving(true)
    void saveUrl(normalized)
      .then(() => {
        toast.success(translate('auto.components.taskPageBrowser.saved', 'URL saved.'))
        onDone()
      })
      .catch(() => {
        toast.error(
          translate('auto.components.taskPageBrowser.saveFailed', 'Could not save the URL.')
        )
      })
      .finally(() => {
        setSaving(false)
      })
  }

  return (
    <form
      className="flex min-h-0 flex-1 items-center justify-center px-6"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="w-full max-w-md space-y-2">
        <div className="space-y-1">
          <Label htmlFor="task-page-browser-url">
            {translate('auto.components.taskPageBrowser.urlLabel', 'Page URL')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.taskPageBrowser.urlDescription',
              'Set the page this browser tab opens.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="task-page-browser-url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={translate(
              'auto.components.taskPageBrowser.urlPlaceholder',
              'https://example.com'
            )}
            spellCheck={false}
            autoComplete="off"
            disabled={saving}
            className="h-8 min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={saving}>
            {translate('auto.components.taskPageBrowser.save', 'Save')}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
              {translate('auto.components.taskPageBrowser.cancel', 'Cancel')}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}
