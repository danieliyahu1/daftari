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
    date: 1_700_000_000,
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
    expect(screen.getByTestId('book-direction')).toHaveTextContent('IN')
    expect(screen.getByTestId('book-amount')).toHaveTextContent('+1 KAS')
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
    expect(screen.getByTestId('book-direction')).toHaveTextContent('OUT')
    expect(screen.getByTestId('book-amount')).toHaveTextContent('−1 KAS')
  })
})
