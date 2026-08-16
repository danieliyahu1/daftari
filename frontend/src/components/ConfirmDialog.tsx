import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    cancelRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div className="overlay" role="presentation" data-testid="confirm-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-dialog-panel"
      >
        <h2 className="dialog-title">{title}</h2>
        <p className="dialog-copy">{message}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="button button-secondary"
            onClick={onCancel}
            disabled={busy}
            data-testid="confirm-cancel"
          >
            Back
          </button>
          <button
            className="button button-primary"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-confirm"
          >
            {busy ? 'Removing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
