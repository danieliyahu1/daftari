import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RegistryGate } from './components/RegistryGate'
import { ToastProvider } from './components/Toaster'
import { WalletStatus } from './components/WalletStatus'
import { BookPage } from './pages/BookPage'
import { ContributePage } from './pages/ContributePage'
import { HomePage } from './pages/HomePage'
import { RegistryProvider } from './wallet/registry'
import { WalletProvider } from './wallet/WalletProvider'

function App(): JSX.Element {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <WalletProvider>
          <AuthProvider>
            <RegistryProvider>
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
                    <RegistryGate>
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/groups/:code" element={<BookPage />} />
                        <Route path="/contribute/:code" element={<ContributePage />} />
                      </Routes>
                    </RegistryGate>
                  </main>
                  <footer className="app-footer">
                    <p>On testnet-10</p>
                  </footer>
                </div>
              </BrowserRouter>
            </RegistryProvider>
          </AuthProvider>
        </WalletProvider>
      </ErrorBoundary>
    </ToastProvider>
  )
}

export default App
