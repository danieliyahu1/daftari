import { Link } from 'react-router-dom'

interface GroupCardProps {
  code: string
  name: string
}

export function GroupCard({ code, name }: GroupCardProps): JSX.Element {
  return (
    <li className="group-card" data-testid="group-card">
      <Link className="group-card-link" to={`/groups/${encodeURIComponent(code)}`}>
        <span className="group-card-name" title={code}>
          {name}
        </span>
      </Link>
    </li>
  )
}