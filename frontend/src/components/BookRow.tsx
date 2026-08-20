import type { BookRow as BookRowType } from '../../../shared/types'
import { formatDate, sompiToKas } from '../format'

interface BookRowProps {
  row: BookRowType
  onAdd?: () => void
  addBusy?: boolean
}

export function BookRow({ row, onAdd, addBusy = false }: BookRowProps): JSX.Element {
  const isIn = row.direction === 'in'
  const sign = isIn ? '+' : '−'
  return (
    <li className="book-row" data-testid="book-row">
      <div className="book-row-body">
        <span
          className={`book-amount mono book-amount--${row.direction}`}
          data-testid="book-amount"
        >
          {sign}{sompiToKas(row.amount_sompi)}
        </span>
        {row.other_name ? (
          <span className="book-party">
            <span className="book-party-name" title={row.other_address}>
              {row.other_name}
            </span>
            <span className="kind-mark" data-testid="book-party-kind">
              {row.other_kind === 'group' ? 'chama' : ''}
            </span>
          </span>
        ) : (
          <span
            className="book-party book-party--unnamed"
            title={row.other_address}
            data-testid="book-party-address"
            role="button"
            tabIndex={0}
            onClick={() => void navigator.clipboard.writeText(row.other_address)}
          >
            Unnamed
          </span>
        )}
      </div>
      <div className="book-row-meta">
        <span className="book-date" data-testid="book-date">
          {formatDate(row.date / 1000)}
        </span>
        <span
          className="book-proof"
          data-testid="book-proof"
          title={row.txid}
          role="button"
          tabIndex={0}
          onClick={() => void navigator.clipboard.writeText(row.txid)}
        >
          proof
        </span>
        {onAdd ? (
          <button
            className="button button-sm button-secondary add-member"
            onClick={onAdd}
            disabled={addBusy}
            data-testid="add-member"
          >
            {addBusy ? 'Adding...' : 'Add to chama'}
          </button>
        ) : null}
      </div>
    </li>
  )
}
