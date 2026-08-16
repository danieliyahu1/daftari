import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Wallet } from '../../../shared/types'
import { ToastProvider } from '../../src/components/Toaster'
import { HomePage } from '../../src/pages/HomePage'
import { RegistryProvider } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { CHAMA_ADDRESS, installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const NO_CHAMAS_COPY = 'Your chamas appear here once you\u2019re part of one.'
const NO_MEMBERS_COPY = 'Your people appear here as they join.'

function renderHome(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <RegistryProvider>
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        </RegistryProvider>
      </WalletProvider>
    </ToastProvider>,
  )
}

function userWallet(): Wallet {
  return { address: USER_ADDRESS, name: 'Amina', kind: 'user', created_at: 1_700_000_000_000 }
}

function groupWallet(): Wallet {
  return { address: CHAMA_ADDRESS, name: 'Plot', kind: 'group', created_at: 1_700_000_000_000 }
}

describe('HomePage', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the connect prompt when the wallet is not connected', async () => {
    uninstallKastle()
    renderHome()
    expect(
      screen.getByText('Connect your wallet to see your chamas.'),
    ).toBeInTheDocument()
  })

  it('shows the no-chamas copy for a person with no chamas', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [userWallet()] } },
      'GET /api/memberships': { body: { identity: userWallet(), members: [], chamas: [] } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.getByText(NO_CHAMAS_COPY)).toBeInTheDocument()
  })

  it('lists the registered chamas for a person', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [userWallet()] } },
      'GET /api/memberships': {
        body: {
          identity: userWallet(),
          members: [],
          chamas: [{ address: CHAMA_ADDRESS, name: 'Plot', kind: 'group' }],
        },
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    expect(screen.getByText('Your chamas')).toBeInTheDocument()
    expect(screen.getByText('Plot')).toBeInTheDocument()
  })

  it('shows the no-members copy for a group with no members yet', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [groupWallet()] } },
      'GET /api/memberships': { body: { identity: groupWallet(), members: [], chamas: [] } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.getByText(NO_MEMBERS_COPY)).toBeInTheDocument()
  })

  it('shows the roster for a group, names for registered members and addresses otherwise', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [groupWallet()] } },
      'GET /api/memberships': {
        body: {
          identity: groupWallet(),
          members: [
            { address: USER_ADDRESS, name: 'Amina', kind: 'user' },
            { address: CHAMA_ADDRESS },
          ],
          chamas: [],
        },
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('roster-member')).toHaveLength(2))
    expect(screen.getByText('Your people')).toBeInTheDocument()
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByText('kaspatest:...rle5a7')).toBeInTheDocument()
  })

  it('shows the connected user identifier at the top', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [userWallet()] } },
      'GET /api/memberships': { body: { identity: userWallet(), members: [], chamas: [] } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByTestId('identity-kind')).toHaveTextContent('person')
  })

  it('shows an error state when loading home fails', async () => {
    stubApi({
      'GET /api/memberships': { status: 503, body: { error: { kind: 'network', message: 'The server is unreachable.' } } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-error')).toBeInTheDocument())
    expect(screen.getByText('The server is unreachable.')).toBeInTheDocument()
  })
})