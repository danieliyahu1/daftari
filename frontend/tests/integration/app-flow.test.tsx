import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BookRow, Membership, Wallet } from '../../../shared/types'
import App from '../../src/App'
import { CHAMA_ADDRESS, installConnectedKastle, uninstallKastle, USER_ADDRESS } from '../helpers'

function setupBackend(options: { named?: boolean } = {}): void {
  const memberships: Membership[] = []
  const rows: BookRow[] = []
  const wallets = new Map<string, Wallet>()
  if (options.named !== false) {
    wallets.set(USER_ADDRESS, {
      address: USER_ADDRESS,
      name: 'Amina',
      kind: 'user',
      created_at: 1_700_000_000_000,
    })
  }
  let balance = 0n
  const TXID = 'dd'.repeat(32)

  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const parsed = new URL(url, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = parsed.pathname
    let body: Record<string, unknown> = {}
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body)) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    const json = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (method === 'GET' && path === '/api/wallets/resolve') {
      const addresses = (parsed.searchParams.get('addresses') ?? '').split(',').filter(Boolean)
      return json(200, { wallets: addresses.map((a) => wallets.get(a)).filter(Boolean) })
    }
    if (method === 'POST' && path === '/api/wallets/register') {
      const wallet: Wallet = {
        address: String(body.address ?? ''),
        name: String(body.name ?? ''),
        kind: body.kind === 'group' ? 'group' : 'user',
        created_at: 1_700_000_000_000,
      }
      wallets.set(wallet.address, wallet)
      return json(201, { wallet })
    }
    if (method === 'GET' && path === '/api/memberships') {
      return json(200, { memberships })
    }
    if (method === 'POST' && path === '/api/memberships') {
      const membership: Membership = {
        user_address: String(body.user_address ?? ''),
        chama_address: String(body.chama_address ?? ''),
        created_at: 1_700_000_000_000,
      }
      memberships.push(membership)
      return json(201, { outcome: 'joined', membership })
    }
    if (method === 'DELETE' && path === '/api/memberships') {
      memberships.length = 0
      return json(200, { outcome: 'left' })
    }
    if (method === 'GET' && path.startsWith('/api/chamas/') && path.endsWith('/book')) {
      return json(200, { balance_sompi: balance.toString(), rows: [...rows] })
    }
    if (method === 'POST' && path === '/api/payments/prepare') {
      return json(200, { signing_template: '{"version":0}' })
    }
    if (method === 'POST' && path === '/api/payments/finalize') {
      if (body.signed === 'REJECT') {
        return json(422, { error: { kind: 'conflict', message: 'Transaction was rejected by the node' } })
      }
      rows.unshift({
        direction: 'in',
        amount_sompi: '1000000000',
        other_address: USER_ADDRESS,
        date: 1_700_000_000_000,
        txid: TXID,
        proof_url: `https://explorer-tn10.kaspa.org/txs/${TXID}`,
      })
      balance += 1_000_000_000n
      return json(200, { status: 'recorded', txid: TXID })
    }
    return json(404, { error: { kind: 'invalid', message: 'not found' } })
  })
}

describe('whole demo flow — integration', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('connects, joins by code, reads the book, pays in, sees the row — and a failed payment leaves no row', async () => {
    setupBackend()
    render(<App />)

    // 1. Connect — identity is the connected Kastle account
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    expect(screen.getByTestId('network-badge')).toHaveTextContent('testnet-10')

    // 2. Home starts empty, then a join by code adds the group immediately
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(
      screen.getByText('Join your first group — enter the code your group shared with you.'),
    ).toBeInTheDocument()
    await userEvent.type(screen.getByTestId('join-code-input'), CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))

    // 3. Open the book — balance on top, empty book copy (SC-3)
    await userEvent.click(screen.getByTestId('group-card').querySelector('a')!)
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.getByTestId('book-balance')).toHaveTextContent('0 KAS')
    expect(
      screen.getByText('No payments yet. The book starts with the first payment in.'),
    ).toBeInTheDocument()

    // 4. Pay in — amount → review → approve → sent (SC-4)
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '10')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    expect(
      within(dialog).getByText(/Pay 10 KAS into kaspatest:\.\.\./),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByTestId('pay-approve'))
    await waitFor(() => expect(within(dialog).getByTestId('pay-sent')).toBeInTheDocument())
    expect(
      within(dialog).getByText('Payment recorded.'),
    ).toBeInTheDocument()

    // 5. Back to the book — the recorded row appears (SC-4) with its proof (SC-6)
    await userEvent.click(within(dialog).getByTestId('pay-back-to-book'))
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(1))
    const row = screen.getByTestId('book-row')
    expect(within(row).getByTestId('book-amount')).toHaveTextContent('+10 KAS')
    expect(within(row).getByTestId('book-amount')).toHaveClass('book-amount--in')
    const proof = within(row).getByTestId('book-proof')
    expect(proof).toHaveAttribute(
      'href',
      `https://explorer-tn10.kaspa.org/txs/${'dd'.repeat(32)}`,
    )
    expect(proof).toHaveTextContent('Open the permanent record')

    // 6. Failed payment — the rejection copy, and no phantom row (SC-5)
    window.kastle!.signTx = async () => 'REJECT'
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog2 = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog2).getByTestId('pay-amount-input'), '10')
    await userEvent.click(within(dialog2).getByTestId('pay-next'))
    await userEvent.click(within(dialog2).getByTestId('pay-approve'))
    await waitFor(() => expect(within(dialog2).getByTestId('pay-failed')).toBeInTheDocument())
    expect(
      within(dialog2).getByText(
        'Your payment didn\u2019t go through. Nothing was paid and nothing is in the book.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog2).getByTestId('pay-failed-close'))

    // Still exactly one row — the failed payment never reached the book
    expect(screen.getAllByTestId('book-row')).toHaveLength(1)
  })

  it('leaves no row in the book when the wallet cannot sign', async () => {
    setupBackend()
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    await userEvent.type(screen.getByTestId('join-code-input'), CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    await userEvent.click(screen.getByTestId('group-card').querySelector('a')!)
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())

    // The wallet rejects the sign request exactly as the real Kastle does
    window.kastle!.signTx = async () => {
      throw new Error('Expected string, received object')
    }

    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '10')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-error')).toBeInTheDocument())
    expect(
      within(dialog).getByText('Kastle couldn\u2019t sign the payment. Try again.'),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByTestId('pay-error-close'))

    // The unsignable payment must not appear in the book
    expect(screen.queryAllByTestId('book-row')).toHaveLength(0)
  })

  it('removes a group after confirmation and returns to the empty home state', async () => {
    setupBackend()
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    await userEvent.type(screen.getByTestId('join-code-input'), CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))

    await userEvent.click(screen.getByTestId('remove-group-button'))
    const confirm = screen.getByTestId('confirm-dialog-panel')
    expect(
      within(confirm).getByText(
        /Remove .+ from your home screen\? The book is still there — you can rejoin with the code\./,
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(confirm).getByTestId('confirm-confirm'))

    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.queryAllByTestId('group-card')).toHaveLength(0)
  })

  it('registers a first-time wallet and recognizes it on the next sign-in', async () => {
    setupBackend({ named: false })
    render(<App />)

    // Connected but unnamed: the naming gate blocks the app (FR-8, SC-3)
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('naming-screen')).toBeInTheDocument())
    expect(screen.queryByTestId('home')).not.toBeInTheDocument()

    // Exact prompt copy; nothing preselected and continue disabled until a kind is chosen (SC-10)
    expect(screen.getByText('Give this wallet a name.')).toBeInTheDocument()
    expect(screen.getByTestId('kind-option-user')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('kind-option-group')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('naming-submit')).toBeDisabled()

    await userEvent.type(screen.getByTestId('naming-name-input'), 'Amina')
    await userEvent.click(screen.getByTestId('kind-option-user'))
    expect(screen.getByTestId('naming-submit')).toBeEnabled()
    await userEvent.click(screen.getByTestId('naming-submit'))

    // Success copy, then the app renders and the profile header shows the name (FR-17)
    await waitFor(() => expect(screen.getByTestId('naming-success-copy')).toBeInTheDocument())
    expect(screen.getByTestId('naming-success-copy')).toHaveTextContent(
      'You\u2019re all set, Amina.',
    )
    await waitFor(
      () => expect(screen.getByTestId('home-empty')).toBeInTheDocument(),
      { timeout: 3_000 },
    )
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByTestId('identity-kind')).toHaveTextContent('person')

    // Disconnect and reconnect: recognized by name, no naming asked again (FR-1/7, SC-2)
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('naming-screen')).not.toBeInTheDocument()
  })
})
