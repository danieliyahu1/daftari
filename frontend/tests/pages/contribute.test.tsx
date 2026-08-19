import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../src/components/Toaster'
import { ContributePage } from '../../src/pages/ContributePage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { type Registry } from '../../src/wallet/registry'
import { CHAMA_ADDRESS, GROUP_STUB, installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', error: null, address: USER_ADDRESS, signIn: vi.fn(async () => {}) }),
}))

let registryValue: Registry = namedRegistry()

function namedRegistry(): Registry {
  return {
    status: 'named',
    identity: null,
    error: null,
    register: vi.fn(async () => {}),
    retry: vi.fn(),
  }
}

vi.mock('../../src/wallet/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/wallet/registry')>()
  return {
    ...actual,
    useRegistry: () => registryValue,
  }
})

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
    registryValue = namedRegistry()
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

  it('asks an unregistered person to name their wallet before joining', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [GROUP_STUB] } } })
    registryValue = {
      status: 'unnamed',
      identity: null,
      error: null,
      register: vi.fn(async () => {}),
      retry: vi.fn(),
    }
    renderContribute()

    await waitFor(() => expect(screen.getByTestId('contribute-group')).toBeInTheDocument())
    expect(screen.getByTestId('contribute-name-first')).toHaveTextContent(
      'Name your wallet in the app before you can join.',
    )
    expect(screen.queryByTestId('contribute-button')).not.toBeInTheDocument()
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