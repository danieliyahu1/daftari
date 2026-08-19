import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BookPage } from '../../src/pages/BookPage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { bookStub, CHAMA_ADDRESS, installConnectedKastle, installDisconnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', error: null, address: USER_ADDRESS, signIn: vi.fn(async () => {}) }),
}))

const BOOK_PATH = `GET /api/chamas/${encodeURIComponent(CHAMA_ADDRESS)}/book`
const ROUTE = `/groups/${encodeURIComponent(CHAMA_ADDRESS)}`

const TXID = 'ab'.repeat(32)
const PROOF = `https://explorer-tn10.kaspa.org/txs/${TXID}`

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    direction: 'in',
    amount_sompi: '100000000',
    other_address: USER_ADDRESS,
    date: 1_700_000_000_000,
    txid: TXID,
    proof_url: PROOF,
    ...overrides,
  }
}

function renderBook(): void {
  render(
    <WalletProvider>
      <MemoryRouter initialEntries={[ROUTE]}>
        <Routes>
          <Route path="/groups/:code" element={<BookPage />} />
        </Routes>
      </MemoryRouter>
    </WalletProvider>,
  )
}

describe('BookPage', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the loading state while reading the book', async () => {
    let resolveFetch: (() => void) | undefined
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = () =>
        resolve(
          new Response(JSON.stringify(bookStub()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
    })
    global.fetch = vi.fn(async () => pending)
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-loading')).toBeInTheDocument())
    resolveFetch?.()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
  })

  it('pins the group balance on top', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub({ balance_sompi: '5000000000' }) } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.getByText('The group has')).toBeInTheDocument()
    expect(screen.getByTestId('book-balance')).toHaveTextContent('50 KAS')
  })

  it('shows the registered group name in the book header', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub({ balance_sompi: '0', rows: [] }) } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-group')).toBeInTheDocument())
    expect(screen.getByTestId('book-group')).toHaveTextContent('Plot')
    expect(screen.getByTestId('book-group-kind')).toHaveTextContent('group')
  })

  it('shows a registered counterparty by name with a person mark in the book', async () => {
    stubApi({
      [BOOK_PATH]: {
        body: bookStub({
          rows: [makeRow({ other_name: 'Amina', other_kind: 'user' })],
        }),
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
    const row = screen.getByTestId('book-row')
    expect(within(row).getByText('Amina')).toBeInTheDocument()
    expect(within(row).getByTestId('book-party-kind')).toHaveTextContent('person')
  })

  it('refuses an unregistered group with the exact copy', async () => {
    stubApi({
      [BOOK_PATH]: {
        status: 422,
        body: { error: { kind: 'invalid', message: "This isn't a registered group." } },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
    expect(
      screen.getByText("This isn't a registered group."),
    ).toBeInTheDocument()
  })

  it('shows the empty-book copy while keeping the balance', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub() } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(
      screen.getByText('No payments yet. The book starts with the first payment in.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('book-balance')).toHaveTextContent('0 KAS')
  })

  it('renders each row with direction, amount, party, date, and proof', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub({ balance_sompi: '100000000', rows: [makeRow()] }) } })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
    const row = screen.getByTestId('book-row')
    expect(within(row).getByTestId('book-amount')).toHaveTextContent('+1 KAS')
    expect(within(row).getByText('kaspat...ukdl')).toBeInTheDocument()
    expect(within(row).getByTestId('book-date')).toHaveTextContent(/2023/)
    const proof = within(row).getByTestId('book-proof')
    expect(proof).toHaveAttribute('href', PROOF)
    expect(proof).toHaveAttribute('target', '_blank')
    expect(proof).toHaveTextContent('Open the permanent record')
  })

  it('shows the out direction for money going out', async () => {
    stubApi({
      [BOOK_PATH]: {
        body: bookStub({ rows: [makeRow({ direction: 'out' })] }),
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
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
          return bookStub({ rows: calls.length === 1 ? pageOne : pageTwo })
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
          return bookStub()
        },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Try again'))
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
  })

  it('links back to the chamas list', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub() } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('back-link')).toBeInTheDocument())
    expect(screen.getByTestId('back-link')).toHaveTextContent('Your chamas')
  })

  it('hides the pay entry point on the wrong network', async () => {
    const mock = installConnectedKastle()
    ;(mock.getNetwork as ReturnType<typeof vi.fn>).mockResolvedValue('mainnet')
    stubApi({ [BOOK_PATH]: { body: bookStub() } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
  })

  it('shows the member-only copy when the requester is not a member', async () => {
    stubApi({
      [BOOK_PATH]: {
        status: 422,
        body: { error: { kind: 'policy', message: 'Only members can see this chama.' } },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
    expect(screen.getByText('Only members can see this chama.')).toBeInTheDocument()
  })

  it('lets the group wallet add a non-member from the book', async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    let memberAdded = false
    stubApi({
      [BOOK_PATH]: {
        body: () => bookStub({ rows: [makeRow({ other_is_member: memberAdded })] }),
      },
      'POST /api/memberships': {
        status: 201,
        body: () => {
          memberAdded = true
          return {
            membership: { user_address: USER_ADDRESS, chama_address: CHAMA_ADDRESS, created_at: 1_700_000_000_000 },
          }
        },
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('add-member')).toBeInTheDocument())

    await userEvent.click(screen.getByTestId('add-member'))

    await waitFor(() => expect(screen.queryByTestId('add-member')).not.toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ group_address: CHAMA_ADDRESS, member_address: USER_ADDRESS }),
      }),
    )
  })

  it('shows Add to chama only for non-member rows and only to the group wallet', async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    stubApi({
      [BOOK_PATH]: {
        body: bookStub({
          rows: [
            makeRow({ other_address: USER_ADDRESS, other_is_member: false }),
            makeRow({
              txid: 'cd'.repeat(32),
              other_address: 'kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8',
              other_is_member: true,
            }),
          ],
        }),
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(2))
    expect(screen.getAllByTestId('add-member')).toHaveLength(1)
  })

  it('hides Add to chama from a member who is not the group wallet', async () => {
    stubApi({
      [BOOK_PATH]: {
        body: bookStub({ rows: [makeRow({ other_is_member: false })] }),
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())
    expect(screen.queryByTestId('add-member')).not.toBeInTheDocument()
  })

  it('offers an invitation link to a member', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStub() } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('invite-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('invite-button'))
    expect(screen.getByTestId('invite-dialog-panel')).toBeInTheDocument()
    expect(screen.getByTestId('invite-link')).toHaveValue(
      `${window.location.origin}/contribute/${encodeURIComponent(CHAMA_ADDRESS)}`,
    )
  })

  it('shows a connect prompt instead of hanging on the spinner when the wallet is installed but not connected', async () => {
    installDisconnectedKastle()
    renderBook()
    await waitFor(
      () => expect(screen.getByText('Connect your wallet to see this chama.')).toBeInTheDocument(),
      { timeout: 1_500 },
    )
    expect(screen.queryByTestId('book-loading')).not.toBeInTheDocument()
  })

  it("does not offer 'Pay into the group' to the group's own wallet", async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    stubApi({ [BOOK_PATH]: { body: bookStub() } })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
  })

  it("does not offer 'Add to chama' for a counterparty that is itself a registered group", async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    stubApi({
      [BOOK_PATH]: {
        body: bookStub({
          rows: [
            makeRow({
              other_address: 'kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8',
              other_name: 'Kamau Traders',
              other_kind: 'group',
              other_is_member: false,
            }),
          ],
        }),
      },
    })
    renderBook()
    await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())
    expect(screen.queryByTestId('add-member')).not.toBeInTheDocument()
  })
})
