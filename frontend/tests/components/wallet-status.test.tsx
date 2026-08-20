import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../src/components/Toaster'
import { WalletStatus } from '../../src/components/WalletStatus'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, uninstallKastle } from '../helpers'

function renderStatus(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <WalletStatus />
      </WalletProvider>
    </ToastProvider>,
  )
}

describe('WalletStatus', () => {
  afterEach(() => {
    uninstallKastle()
    vi.restoreAllMocks()
  })

  it('prompts to install when no wallet is present', () => {
    uninstallKastle()
    renderStatus()
    expect(screen.getByTestId('install-message')).toHaveTextContent(
      'Install the Kastle wallet extension to get started.',
    )
  })

  it('shows the connect button when disconnected', async () => {
    const mock = installConnectedKastle()
    ;(mock.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ address: '' })
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
  })

  it('shows the connected chip without a network badge', async () => {
    installConnectedKastle()
    renderStatus()
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    expect(screen.queryByTestId('network-badge')).not.toBeInTheDocument()
  })

  it('disconnects on demand', async () => {
    installConnectedKastle()
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
})
