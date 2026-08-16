import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { WalletProvider, useWallet } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, uninstallKastle } from '../helpers'

function Probe(): JSX.Element {
  const wallet = useWallet()
  return <div data-testid="probe">{wallet.status}</div>
}

describe('WalletProvider', () => {
  afterEach(() => {
    uninstallKastle()
    vi.restoreAllMocks()
  })

  it('throws when useWallet is used outside the provider', () => {
    expect(() => renderHook(() => useWallet())).toThrow(
      'useWallet must be used within a WalletProvider',
    )
  })

  it('provides the wallet state to children', async () => {
    installConnectedKastle()
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('connected'))
  })
})
