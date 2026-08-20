import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../src/components/Toaster'
import { BookPage } from '../../src/pages/BookPage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { bookStub as bookStubBody, CHAMA_ADDRESS, installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', error: null, address: USER_ADDRESS, signIn: vi.fn(async () => {}) }),
}))

const BOOK_PATH = `GET /api/chamas/${encodeURIComponent(CHAMA_ADDRESS)}/book`
const ROUTE = `/groups/${encodeURIComponent(CHAMA_ADDRESS)}`
const PREPARE = 'POST /api/payments/prepare'
const FINALIZE = 'POST /api/payments/finalize'

function renderBookWithWallet(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <MemoryRouter initialEntries={[ROUTE]}>
          <Routes>
            <Route path="/groups/:code" element={<BookPage />} />
          </Routes>
        </MemoryRouter>
      </WalletProvider>
    </ToastProvider>,
  )
}

function bookStub(): void {
  stubApi({
    [BOOK_PATH]: {
      body: bookStubBody(),
    },
  })
}

describe('PayDialog pay-in flow', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('only shows the pay entry point when the wallet is connected', async () => {
    uninstallKastle()
    bookStub()
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
    expect(
      screen.getByText('Connect to see this chama.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
  })

  it('walks amount → review → approve → signed → finalize → recorded', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: { body: { status: 'recorded', txid: 'ab'.repeat(32) } },
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))

    const dialog = screen.getByTestId('pay-dialog-panel')
    const amountInput = within(dialog).getByTestId('pay-amount-input')
    await userEvent.type(amountInput, '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))

    expect(
      within(dialog).getByText(/Pay 1 KAS into kaspatest:\.\.\./),
    ).toBeInTheDocument()
    expect(within(dialog).getByTestId('pay-approve')).toBeInTheDocument()
    expect(within(dialog).getByTestId('pay-back')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-sent')).toBeInTheDocument())
    expect(
      within(dialog).getByText('Payment recorded.'),
    ).toBeInTheDocument()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/prepare'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(window.kastle?.signTx).toHaveBeenCalledWith('testnet-10', '{"version":0}')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/finalize'),
      expect.objectContaining({ method: 'POST' }),
    )

    await userEvent.click(within(dialog).getByTestId('pay-back-to-book'))
    expect(screen.queryByTestId('pay-dialog')).not.toBeInTheDocument()
  })

  it('shows a still-confirming panel with an explorer link when acceptance is pending', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: {
        body: {
          status: 'pending',
          txid: 'ab'.repeat(32),
        },
      },
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-pending')).toBeInTheDocument())
    expect(within(dialog).getByText('Still confirming…')).toBeInTheDocument()
    expect(within(dialog).getByTestId('pay-pending')).toHaveTextContent('abababab...ababab')

    await userEvent.click(within(dialog).getByTestId('pay-back-to-book'))
    expect(screen.queryByTestId('pay-dialog')).not.toBeInTheDocument()
  })

  it('returns to the amount entry when Back is pressed on the review step', async () => {
    bookStub()
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '2.5')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    expect(within(dialog).getByTestId('pay-back')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByTestId('pay-back'))
    expect(within(dialog).getByTestId('pay-amount-input')).toBeInTheDocument()
  })

  it('validates the amount before review', async () => {
    bookStub()
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), 'abc')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    expect(
      within(dialog).getByText('Amount must be a positive number with up to 8 decimal places'),
    ).toBeInTheDocument()
  })

  it('keeps Next disabled until an amount is entered', async () => {
    bookStub()
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    expect(within(dialog).getByTestId('pay-next')).toBeDisabled()
  })

  it('shows the failure copy when the payment cannot be afforded', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: {
        status: 422,
        body: { error: { kind: 'policy', message: 'Insufficient funds' } },
      },
      [FINALIZE]: { body: { status: 'recorded', txid: 'ab'.repeat(32) } },
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-failed')).toBeInTheDocument())
    expect(
      within(dialog).getByText(
        'Your payment didn\u2019t go through. Nothing was paid and nothing is in the book.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/finalize'),
      expect.anything(),
    )
  })

  it('shows the failure copy when the payment does not go through', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: {
        status: 422,
        body: { error: { kind: 'conflict', message: 'Transaction was rejected by the node' } },
      },
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-failed')).toBeInTheDocument())
    expect(
      within(dialog).getByText(
        'Your payment didn\u2019t go through. Nothing was paid and nothing is in the book.',
      ),
    ).toBeInTheDocument()
  })

  it('shows an error panel when the network fails during prepare', async () => {
    stubApi({ [BOOK_PATH]: { body: bookStubBody() } })
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/payments/prepare')) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(bookStubBody()), { status: 200 })
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-error')).toBeInTheDocument())
    expect(
      within(dialog).getByText(/Network error\. Check your connection and try again\./),
    ).toBeInTheDocument()
  })

  it('surfaces a signing failure instead of silently returning to review', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: { body: { status: 'recorded', txid: 'ab'.repeat(32) } },
    })
    window.kastle!.signTx = vi.fn(async () => {
      throw new Error('Expected string, received object')
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-error')).toBeInTheDocument())
    expect(
      within(dialog).getByText('Couldn\u2019t sign. Try again.'),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/finalize'),
      expect.anything(),
    )
  })

  it('treats a declined signing as cancelled and never finalizes', async () => {
    stubApi({
      [BOOK_PATH]: { body: bookStubBody() },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: { body: { status: 'recorded', txid: 'ab'.repeat(32) } },
    })
    window.kastle!.signTx = vi.fn(async () => {
      const error = new Error('user rejected the request')
      ;(error as { code?: number }).code = 4001
      throw error
    })
    renderBookWithWallet()
    await waitFor(() => expect(screen.getByTestId('pay-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('pay-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '1')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))

    await waitFor(() => expect(within(dialog).getByTestId('pay-back')).toBeInTheDocument())
    expect(screen.getByText('Signing cancelled.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/finalize'),
      expect.anything(),
    )
  })
})
