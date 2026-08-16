import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Wallet } from '../../../shared/types'
import { RegistryProvider, useRegistry } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const REGISTERED: Wallet = {
  address: USER_ADDRESS,
  name: 'Amina',
  kind: 'user',
  created_at: 1_700_000_000_000,
}

function Probe(): JSX.Element {
  const registry = useRegistry()
  return (
    <div>
      <span data-testid="status">{registry.status}</span>
      <span data-testid="identity">{registry.identity ? registry.identity.name : 'none'}</span>
      <span data-testid="error">{registry.error ?? 'none'}</span>
      <button onClick={registry.retry} data-testid="retry">
        retry
      </button>
      <button onClick={() => void registry.register('Amina', 'user')} data-testid="register">
        register
      </button>
    </div>
  )
}

function renderRegistry(): void {
  render(
    <WalletProvider>
      <RegistryProvider>
        <Probe />
      </RegistryProvider>
    </WalletProvider>,
  )
}

describe('RegistryProvider', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('marks the wallet named when resolve finds it', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    renderRegistry()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('named'))
    expect(screen.getByTestId('identity')).toHaveTextContent('Amina')
  })

  it('marks the wallet unnamed when resolve omits it', async () => {
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderRegistry()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unnamed'))
    expect(screen.getByTestId('identity')).toHaveTextContent('none')
  })

  it('surfaces a resolve error and recovers on retry', async () => {
    stubApi({
      'GET /api/wallets/resolve': {
        status: 503,
        body: { error: { kind: 'network', message: 'The server is unreachable.' } },
      },
    })
    renderRegistry()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    expect(screen.getByTestId('error')).toHaveTextContent('The server is unreachable.')

    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [REGISTERED] } } })
    fireEvent.click(screen.getByTestId('retry'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('named'))
  })

  it('resets to checking when the wallet disconnects', async () => {
    const kastle = installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
    renderRegistry()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unnamed'))

    kastle.emit('accountsChanged', [])

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('checking'))
  })

  it('re-checks and recognizes the wallet after a successful register', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [] } },
      'POST /api/wallets/register': { status: 201, body: { wallet: REGISTERED } },
    })
    renderRegistry()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unnamed'))
    fireEvent.click(screen.getByTestId('register'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('naming-success'))
    expect(screen.getByTestId('identity')).toHaveTextContent('Amina')
    await waitFor(
      () => expect(screen.getByTestId('status')).toHaveTextContent('named'),
      { timeout: 3_000 },
    )
  })
})