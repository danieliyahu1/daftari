import { ErrorBoundary } from './components/ErrorBoundary'
import { EmptyState } from './components/EmptyState'
import { ToastProvider } from './components/Toaster'
import { WalletStatus } from './components/WalletStatus'
import { WalletProvider } from './wallet/WalletProvider'

function App(): JSX.Element {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <WalletProvider>
          <div className="app">
            <header className="app-header">
              <h1>Daftari</h1>
              <WalletStatus />
            </header>
            <main className="app-main">
              <EmptyState title="Connect your wallet to see your chamas." />
            </main>
            <footer className="app-footer">
              <p>On testnet-10</p>
            </footer>
          </div>
        </WalletProvider>
      </ErrorBoundary>
    </ToastProvider>
  )
}

export default App
