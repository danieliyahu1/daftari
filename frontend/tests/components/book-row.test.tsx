import { render, screen } from '@testing-library/react'
import type { BookRow } from '../../../shared/types'
import { BookRow as BookRowComponent } from '../../src/components/BookRow'
import { USER_ADDRESS } from '../helpers'

const TXID = 'ab'.repeat(32)

function makeRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    direction: 'in',
    amount_sompi: '100000000',
    other_address: USER_ADDRESS,
    date: 1_700_000_000_000,
    txid: TXID,
    proof_url: `https://explorer-tn10.kaspa.org/txs/${TXID}`,
    ...overrides,
  }
}

describe('BookRow', () => {
  it('renders an incoming row with amount, party, and proof', () => {
    render(
      <ul>
        <BookRowComponent row={makeRow()} />
      </ul>,
    )
    expect(screen.getByTestId('book-amount')).toHaveTextContent('+1 KAS')
    expect(screen.getByTestId('book-amount')).toHaveClass('book-amount--in')
    expect(screen.getByText('kaspat...ukdl')).toBeInTheDocument()
    expect(screen.getByTestId('book-date')).toHaveTextContent(/2023/)
    expect(screen.getByTestId('book-proof')).toHaveAttribute(
      'href',
      `https://explorer-tn10.kaspa.org/txs/${TXID}`,
    )
  })

  it('renders an outgoing row with a minus amount', () => {
    render(
      <ul>
        <BookRowComponent row={makeRow({ direction: 'out' })} />
      </ul>,
    )
    expect(screen.getByTestId('book-amount')).toHaveTextContent('−1 KAS')
    expect(screen.getByTestId('book-amount')).toHaveClass('book-amount--out')
  })

  it('shows a registered counterparty by name with a person mark', () => {
    render(
      <ul>
        <BookRowComponent
          row={makeRow({ other_name: 'Amina', other_kind: 'user' })}
        />
      </ul>,
    )
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByTestId('book-party-kind')).toHaveTextContent('person')
    expect(screen.queryByTestId('book-party-address')).not.toBeInTheDocument()
  })

  it('marks a registered group counterparty as a group', () => {
    render(
      <ul>
        <BookRowComponent
          row={makeRow({ other_name: 'Kamau Traders', other_kind: 'group' })}
        />
      </ul>,
    )
    expect(screen.getByText('Kamau Traders')).toBeInTheDocument()
    expect(screen.getByTestId('book-party-kind')).toHaveTextContent('group')
  })

  it('falls back to the raw address when the counterparty is not registered', () => {
    render(
      <ul>
        <BookRowComponent row={makeRow()} />
      </ul>,
    )
    expect(screen.getByTestId('book-party-address')).toHaveTextContent('kaspat...ukdl')
    expect(screen.queryByTestId('book-party-kind')).not.toBeInTheDocument()
  })
})
