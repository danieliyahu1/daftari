import type { ReactNode } from 'react'
import { useRegistry } from '../wallet/registry'
import { useWallet } from '../wallet/WalletProvider'
import { NamingScreen } from './NamingScreen'

interface RegistryGateProps {
  children: ReactNode
}

export function RegistryGate({ children }: RegistryGateProps): JSX.Element {
  const wallet = useWallet()
  const registry = useRegistry()

  if (wallet.status !== 'connected' || !wallet.address) {
    return <>{children}</>
  }

  switch (registry.status) {
    case 'named':
      return <>{children}</>
    case 'unnamed':
    case 'naming-success':
      return <NamingScreen />
    case 'error':
      return (
        <div className="error-container" data-testid="registry-error">
          <p>{registry.error}</p>
          <button
            className="button button-secondary"
            onClick={registry.retry}
            data-testid="registry-retry"
          >
            Try again
          </button>
        </div>
      )
    case 'checking':
    default:
      return (
        <div className="loading-container" data-testid="registry-loading">
          <p>Looking you up...</p>
        </div>
      )
  }
}