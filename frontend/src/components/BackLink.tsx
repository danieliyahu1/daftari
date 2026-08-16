import { Link } from 'react-router-dom'

interface BackLinkProps {
  to: string
  label: string
}

export function BackLink({ to, label }: BackLinkProps): JSX.Element {
  return (
    <Link className="back-link" to={to} data-testid="back-link">
      ← {label}
    </Link>
  )
}
