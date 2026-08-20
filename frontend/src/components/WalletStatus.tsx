import { useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { KASTLE_EXTENSION_URL } from '../constants'
import { EXPECTED_NETWORK } from '../wallet/kastle'
import { useRegistry } from '../wallet/registry'
import { useWallet } from '../wallet/WalletProvider'
import { useToast } from './Toaster'

export function WalletStatus(): JSX.Element {
  const wallet = useWallet()
  const auth = useAuth()
  const registry = useRegistry()
  const { showToast } = useToast()

  useEffect(() => {
    if (!wallet.error) return
    showToast({ message: wallet.error, kind: 'error' })
    wallet.clearError()
  }, [wallet.error, wallet.clearError, showToast])

  if (wallet.status === 'connected' && wallet.address) {
    if (auth.status === 'ready') {
      return (
        <div className="wallet-connected" data-testid="wallet-connected">
          {registry.identity?.name && (
            <span className="wallet-address" title={wallet.address}>
              {registry.identity.name}
            </span>
          )}
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

    return (
      <div className="wallet-connected" data-testid="wallet-signing-in">
        <span className="network-badge" data-testid="network-badge">
          Signing in...
        </span>
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
            Install the Kastle wallet extension to get started.
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
        {wallet.status === 'connecting' ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  )
}
