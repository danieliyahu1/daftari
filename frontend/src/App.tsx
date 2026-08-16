import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toaster'
import { WalletStatus } from './components/WalletStatus'
import { HomePage } from './pages/HomePage'
import { WalletProvider } from './wallet/WalletProvider'

function App(): JSX.Element {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <WalletProvider>
          <BrowserRouter>
            <div className="app">
              <header className="app-header">
                <h1>
                  <Link className="app-title" to="/" aria-label="Daftari home">
                    Daftari
                  </Link>
                </h1>
                <WalletStatus />
              </header>
              <main className="app-main">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                </Routes>
              </main>
              <footer className="app-footer">
                <p>On testnet-10</p>
              </footer>
            </div>
          </BrowserRouter>
        </WalletProvider>
      </ErrorBoundary>
    </ToastProvider>
  )
}

export default App
