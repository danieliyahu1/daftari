import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Auth } from '../../src/auth/AuthProvider'
import type { Wallet } from '../../../shared/types'
import { ToastProvider } from '../../src/components/Toaster'
import { WalletStatus } from '../../src/components/WalletStatus'
import { RegistryProvider } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const mockSignIn = vi.fn(async () => {})
const defaultAuth: Auth = { status: 'ready', error: null, address: USER_ADDRESS, signIn: mockSignIn }
let authState = { ...defaultAuth }

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))

const REGISTERED: Wallet = {
  address: USER_ADDRESS,
  name: 'Amina',
  kind: 'user',
  created_at: 1_700_000_000_000,
}

function renderStatus(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <RegistryProvider>
          <WalletStatus />
        </RegistryProvider>
      </WalletProvider>
    </ToastProvider>,
  )
}

describe('WalletStatus', () => {
  afterEach(() => {
    authState = { ...defaultAuth }
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prompts to install when no wallet is present', () => {
    uninstallKastle()
    renderStatus()
    const link = screen.getByTestId('install-button')
    expect(link).toHaveTextContent('Install Kastle')
    expect(link).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego')
  })

  it('shows the connect button when disconnected', async () => {
    const mock = installConnectedKastle()
    ;(mock.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ address: '' })
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
  })

  it('shows the registered name and disconnect button', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Amina')).toBeInTheDocument())
    expect(screen.getByTestId('disconnect-button')).toBeInTheDocument()
    expect(screen.queryByTestId('network-badge')).not.toBeInTheDocument()
  })

  it('shows only the disconnect button when the wallet is unnamed', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    expect(screen.getByTestId('disconnect-button')).toBeInTheDocument()
    expect(screen.queryByTestId('network-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(USER_ADDRESS)).not.toBeInTheDocument()
  })

  it('disconnects on demand', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
  })

  it('prompts to switch network and connects after a successful switch', async () => {
    const mock = installConnectedKastle()
    ;(mock.getNetwork as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('mainnet')
      .mockResolvedValueOnce('testnet-10')
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('wrong-network-message')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('switch-network-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    expect(mock.switchNetwork).toHaveBeenCalledWith('testnet-10')
  })

  it('shows sign-in button and toast when auth fails', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    authState = { ...defaultAuth, status: 'error', error: 'Could not sign you in.' }
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('sign-in-button')).toHaveTextContent('Sign In'))
    await waitFor(() => expect(screen.getByTestId('toast-error')).toHaveTextContent('Could not sign you in.'))
  })

  it('shows sign-in button when wallet is connected but auth is idle', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    authState = { ...defaultAuth, status: 'idle', address: null }
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('sign-in-button')).toBeInTheDocument())
    expect(screen.queryByTestId('toast-error')).not.toBeInTheDocument()
  })

  it('calls signIn when sign-in button is clicked', async () => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    authState = { ...defaultAuth, status: 'error', error: 'Could not sign you in.' }
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('sign-in-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('sign-in-button'))
    expect(mockSignIn).toHaveBeenCalledOnce()
  })
})
