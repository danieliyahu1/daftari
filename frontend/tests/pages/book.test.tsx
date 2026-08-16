import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BookPage } from '../../src/pages/BookPage'
import { CHAMA_ADDRESS, stubApi, USER_ADDRESS } from '../helpers'

const BOOK_PATH = `GET /api/chamas/${encodeURIComponent(CHAMA_ADDRESS)}/book`
const ROUTE = `/groups/${encodeURIComponent(CHAMA_ADDRESS)}`

const TXID = 'ab'.repeat(32)
const PROOF = `https://explorer-tn10.kaspa.org/txs/${TXID}`

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    direction: 'in',
    amount_sompi: '100000000',
    other_address: USER_ADDRESS,
    date: 1_700_000_000,
    txid: TXID,
    proof_url: PROOF,
    ...overrides,
  }
}

function renderBook(): void {
  render(
    <MemoryRouter initialEntries={[ROUTE]}>
      <Routes>
        <Route path="/groups/:code" element={<BookPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BookPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the loading state while reading the book', async () => {
    stubApi({ [BOOK_PATH]: { body: () => ({ balance_sompi: '0', rows: [] }) } })
    renderBook()
    expect(screen.getByTestId('book-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
  })

  it('pins the group balance on top', async () => {
    stubApi({ [BOOK_PATH]: { body: { balance_sompi: '5000000000', rows: [] } } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.getByText('The group has')).toBeInTheDocument()
    expect(screen.getByTestId('book-balance')).toHaveTextContent('50 KAS')
  })

  it('shows the empty-book copy while keeping the balance', async () => {
    stubApi({ [BOOK_PATH]: { body: { balance_sompi: '0', rows: [] } } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
    expect(
      screen.getByText('No payments yet. The book starts with the first payment in.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('book-balance')).toHaveTextContent('0 KAS')
  })

  it('renders each row with direction, amount, party, date, and proof', async () => {
    stubApi({ [BOOK_PATH]: { body: { balance_sompi: '100000000', rows: [makeRow()] } } })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
    const row = screen.getByTestId('book-row')
    expect(within(row).getByTestId('book-direction')).toHaveTextContent('IN')
    expect(within(row).getByTestId('book-amount')).toHaveTextContent('+1 KAS')
    expect(within(row).getByText('kaspat...ukdl')).toBeInTheDocument()
    expect(within(row).getByTestId('book-date')).toHaveTextContent(/2023/)
    const proof = within(row).getByTestId('book-proof')
    expect(proof).toHaveAttribute('href', PROOF)
    expect(proof).toHaveTextContent('Open the permanent record')
  })

  it('shows the out direction for money going out', async () => {
    stubApi({
      [BOOK_PATH]: {
        body: { balance_sompi: '0', rows: [makeRow({ direction: 'out' })] },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
    expect(screen.getByTestId('book-direction')).toHaveTextContent('OUT')
    expect(screen.getByTestId('book-amount')).toHaveTextContent('−1 KAS')
  })

  it('loads more rows with pagination', async () => {
    const pageOne = Array.from({ length: 50 }, (_, index) =>
      makeRow({ txid: `${index.toString(16).padStart(2, '0')}`.repeat(32) }),
    )
    const pageTwo = Array.from({ length: 5 }, (_, index) =>
      makeRow({ txid: `ff${index}${'00'.repeat(30)}` }),
    )
    const calls: string[] = []
    stubApi({
      [BOOK_PATH]: {
        body: () => {
          calls.push(String(calls.length))
          return { balance_sompi: '0', rows: calls.length === 1 ? pageOne : pageTwo }
        },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(50))
    const loadMore = screen.getByTestId('load-more')
    expect(loadMore).toBeInTheDocument()
    await userEvent.click(loadMore)
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(55))
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument()
  })

  it('shows an error state with retry when loading fails', async () => {
    let failed = false
    stubApi({
      [BOOK_PATH]: {
        body: () => {
          if (!failed) {
            failed = true
            return new Response('', { status: 503 })
          }
          return { balance_sompi: '0', rows: [] }
        },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Try again'))
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
  })

  it('links back to the chamas list', async () => {
    stubApi({ [BOOK_PATH]: { body: { balance_sompi: '0', rows: [] } } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('back-link')).toBeInTheDocument())
    expect(screen.getByTestId('back-link')).toHaveTextContent('Your chamas')
  })
})
