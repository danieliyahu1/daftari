import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../src/components/Toaster'
import { BookPage } from '../../src/pages/BookPage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { CHAMA_ADDRESS, installConnectedKastle, stubApi, uninstallKastle } from '../helpers'

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
      body: { balance_sompi: '0', rows: [] },
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
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
  })

  it('walks amount → review → approve → signed → finalize → waiting for the record', async () => {
    stubApi({
      [BOOK_PATH]: { body: { balance_sompi: '0', rows: [] } },
      [PREPARE]: { body: { signing_template: '{"version":0}' } },
      [FINALIZE]: { body: { txid: 'ab'.repeat(32) } },
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
      within(dialog).getByText('Payment approved — waiting for the record...'),
    ).toBeInTheDocument()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/prepare'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(window.kastle?.signTx).toHaveBeenCalledWith({ txJson: '{"version":0}' })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/finalize'),
      expect.objectContaining({ method: 'POST' }),
    )

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

  it('shows the failure copy when the payment does not go through', async () => {
    stubApi({
      [BOOK_PATH]: { body: { balance_sompi: '0', rows: [] } },
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
    stubApi({ [BOOK_PATH]: { body: { balance_sompi: '0', rows: [] } } })
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/payments/prepare')) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ balance_sompi: '0', rows: [] }), { status: 200 })
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
})
