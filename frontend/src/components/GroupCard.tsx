import { Link } from 'react-router-dom'
import { shortAddress } from '../format'

interface GroupCardProps {
  code: string
  createdAt: number
  onRemove: (code: string) => void
}

export function GroupCard({ code, createdAt, onRemove }: GroupCardProps): JSX.Element {
  return (
    <li className="group-card" data-testid="group-card">
      <Link className="group-card-link" to={`/groups/${encodeURIComponent(code)}`}>
        <span className="group-card-name mono" title={code}>
          {shortAddress(code, 10, 6)}
        </span>
        <span className="group-card-date">Joined {formatGroupDate(createdAt)}</span>
      </Link>
      <button
        className="group-card-remove"
        onClick={() => onRemove(code)}
        aria-label="Remove group"
        data-testid="remove-group-button"
      >
        Remove
      </button>
    </li>
  )
}

function formatGroupDate(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(epochMs))
}
