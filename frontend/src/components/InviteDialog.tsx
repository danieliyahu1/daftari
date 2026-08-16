import { useState } from 'react'

interface InviteDialogProps {
  groupCode: string
  onClose: () => void
}

export function InviteDialog({ groupCode, onClose }: InviteDialogProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/contribute/${encodeURIComponent(groupCode)}`

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="overlay" role="presentation" data-testid="invite-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Invite someone to contribute"
        data-testid="invite-dialog-panel"
      >
        <h2 className="dialog-title">Invite someone to contribute</h2>
        <p className="dialog-copy">
          Share this link with someone you trust. When they tap it they can pay into the chama —
          then you bring them in.
        </p>
        <input
          className="input input-mono"
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          data-testid="invite-link"
        />
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} data-testid="invite-close">
            Close
          </button>
          <button
            className="button button-primary"
            onClick={() => void copy()}
            data-testid="invite-copy"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}