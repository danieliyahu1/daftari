import type { BookRow as BookRowType } from '../../../shared/types'
import { formatDate, shortAddress, sompiToKas } from '../format'

interface BookRowProps {
  row: BookRowType
}

export function BookRow({ row }: BookRowProps): JSX.Element {
  const isIn = row.direction === 'in'
  const sign = isIn ? '+' : '−'
  return (
    <li className="book-row" data-testid="book-row">
      <span
        className={`book-direction book-direction--${row.direction}`}
        data-testid="book-direction"
      >
        {row.direction.toUpperCase()}
      </span>
      <div className="book-row-body">
        <span className="book-amount mono" data-testid="book-amount">
          {sign}{sompiToKas(row.amount_sompi)} KAS
        </span>
        <span className="book-party mono" title={row.other_address}>
          {shortAddress(row.other_address)}
        </span>
      </div>
      <div className="book-row-meta">
        <span className="book-date" data-testid="book-date">
          {formatDate(row.date)}
        </span>
        <a
          className="book-proof"
          href={row.proof_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="book-proof"
        >
          Open the permanent record
        </a>
      </div>
    </li>
  )
}
