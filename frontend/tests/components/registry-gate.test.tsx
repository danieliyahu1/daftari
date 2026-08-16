import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Wallet } from '../../../shared/types'
import { RegistryGate } from '../../src/components/RegistryGate'
import { RegistryProvider } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const REGISTERED: Wallet = {
  address: USER_ADDRESS,
  name: 'Amina',
  kind: 'user',
  created_at: 1_700_000_000_000,
}

function renderGate(): void {
  render(
    <WalletProvider>
      <RegistryProvider>
        <RegistryGate>
          <div data-testid="app-content">the app</div>
        </RegistryGate>
      </RegistryProvider>
    </WalletProvider>,
  )
}

describe('RegistryGate', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the app for a named wallet', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    renderGate()

    await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument())
    expect(screen.queryByTestId('naming-screen')).not.toBeInTheDocument()
  })

  it('renders the NamingScreen for an unnamed wallet and blocks the app', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderGate()

    await waitFor(() => expect(screen.getByTestId('naming-screen')).toBeInTheDocument())
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()
  })

  it('shows a loading state while resolve is in flight', async () => {
    let resolveFetch!: (response: Response) => void
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    renderGate()

    await waitFor(() => expect(screen.getByTestId('registry-loading')).toBeInTheDocument())

    resolveFetch(
      new Response(JSON.stringify({ wallets: [REGISTERED] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument())
  })

  it('shows a resolve error with a retry that proceeds once fixed', async () => {
    stubApi({
      'GET /api/wallets/resolve': {
        status: 503,
        body: { error: { kind: 'network', message: 'The server is unreachable.' } },
      },
    })
    renderGate()

    await waitFor(() => expect(screen.getByTestId('registry-error')).toBeInTheDocument())
    expect(screen.getByText('The server is unreachable.')).toBeInTheDocument()
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()

    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    await userEvent.click(screen.getByTestId('registry-retry'))

    await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument())
  })

  it('renders the app when the wallet is not connected', async () => {
    uninstallKastle()
    renderGate()

    expect(screen.getByTestId('app-content')).toBeInTheDocument()
  })
})