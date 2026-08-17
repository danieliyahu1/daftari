import { useEffect } from 'react'
import { KASTLE_EXTENSION_URL } from '../constants'
import { formatKastleNetwork, shortAddress } from '../format'
import { EXPECTED_NETWORK } from '../wallet/kastle'
import { useWallet } from '../wallet/WalletProvider'
import { useToast } from './Toaster'

export function WalletStatus(): JSX.Element {
  const wallet = useWallet()
  const { showToast } = useToast()

  useEffect(() => {
    if (!wallet.error) return
    showToast({ message: wallet.error, kind: 'error' })
    wallet.clearError()
  }, [wallet.error, wallet.clearError, showToast])

  if (wallet.status === 'connected' && wallet.address) {
    return (
      <div className="wallet-connected" data-testid="wallet-connected">
        <span className="wallet-address" title={wallet.address}>
          {shortAddress(wallet.address)}
        </span>
        <span className="network-badge" data-testid="network-badge">
          {formatKastleNetwork(wallet.network)}
        </span>
        <button
          className="button button-secondary button-sm"
          onClick={wallet.disconnect}
          data-testid="disconnect-button"
        >
          Disconnect
        </button>
      </div>
    )
  }

  if (wallet.status === 'wrong-network') {
    return (
      <div className="wallet-connect wallet-connect-column">
        <p className="wallet-error-text" data-testid="wrong-network-message">
          You're on the wrong network. Daftari runs on {EXPECTED_NETWORK}.
        </p>
        <button
          className="button button-primary"
          onClick={() => void wallet.switchToTestnet()}
          data-testid="switch-network-button"
        >
          Switch to {EXPECTED_NETWORK}
        </button>
      </div>
    )
  }

  if (wallet.status === 'not-installed') {
    return (
      <div className="wallet-connect">
        {KASTLE_EXTENSION_URL ? (
          <a
            href={KASTLE_EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-primary"
            data-testid="install-button"
          >
            Install Kastle
          </a>
        ) : (
          <p className="wallet-error-text" data-testid="install-message">
            Install Kastle to connect.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="wallet-connect">
      <button
        className="button button-primary"
        onClick={() => void wallet.connect()}
        disabled={wallet.status === 'connecting'}
        data-testid="connect-button"
      >
        {wallet.status === 'connecting' ? 'Connecting...' : 'Connect wallet'}
      </button>
    </div>
  )
}
