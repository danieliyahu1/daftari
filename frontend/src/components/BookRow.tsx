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
      <div className="book-row-body">
        <span
          className={`book-amount mono book-amount--${row.direction}`}
          data-testid="book-amount"
        >
          {sign}{sompiToKas(row.amount_sompi)} KAS
        </span>
        {row.other_name ? (
          <span className="book-party">
            <span className="book-party-name" title={row.other_address}>
              {row.other_name}
            </span>
            <span className="kind-mark" data-testid="book-party-kind">
              {row.other_kind === 'group' ? 'group' : 'person'}
            </span>
          </span>
        ) : (
          <span className="book-party mono" title={row.other_address} data-testid="book-party-address">
            {shortAddress(row.other_address)}
          </span>
        )}
      </div>
      <div className="book-row-meta">
        <span className="book-date" data-testid="book-date">
          {formatDate(row.date / 1000)}
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
