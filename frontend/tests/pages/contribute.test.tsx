import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../src/components/Toaster'
import { ContributePage } from '../../src/pages/ContributePage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { CHAMA_ADDRESS, GROUP_STUB, installConnectedKastle, stubApi, uninstallKastle } from '../helpers'

const ROUTE = `/contribute/${encodeURIComponent(CHAMA_ADDRESS)}`

function renderContribute(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <MemoryRouter initialEntries={[ROUTE]}>
          <Routes>
            <Route path="/contribute/:code" element={<ContributePage />} />
          </Routes>
        </MemoryRouter>
      </WalletProvider>
    </ToastProvider>,
  )
}

describe('ContributePage', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks to connect when no wallet is installed', async () => {
    uninstallKastle()
    renderContribute()
    expect(
      screen.getByText('Connect your wallet to contribute.'),
    ).toBeInTheDocument()
  })

  it('refuses a wallet that is not a registered group', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderContribute()
    await waitFor(() => expect(screen.getByTestId('contribute-error')).toBeInTheDocument())
    expect(screen.getByText("This isn't a registered group.")).toBeInTheDocument()
  })

  it('shows the group and lets an invited person contribute', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [GROUP_STUB] } },
      'POST /api/payments/prepare': { body: { signing_template: '{"version":0}' } },
      'POST /api/payments/finalize': { body: { status: 'recorded', txid: 'ab'.repeat(32) } },
    })
    renderContribute()

    await waitFor(() => expect(screen.getByTestId('contribute-group')).toBeInTheDocument())
    expect(screen.getByText('You were invited to contribute to')).toBeInTheDocument()
    expect(screen.getByText('Plot')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('contribute-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '10')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))
    await waitFor(() => expect(within(dialog).getByTestId('pay-sent')).toBeInTheDocument())
    await userEvent.click(within(dialog).getByTestId('pay-back-to-book'))

    await waitFor(() =>
      expect(screen.getByText('Your contribution is in the book.')).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/The group will bring you in/),
    ).toBeInTheDocument()
  })
})