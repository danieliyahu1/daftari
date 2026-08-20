import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Wallet } from '../../../shared/types'
import { ToastProvider } from '../../src/components/Toaster'
import { HomePage } from '../../src/pages/HomePage'
import { RegistryProvider } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { bookStub, CHAMA_ADDRESS, installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', error: null, address: USER_ADDRESS, signIn: vi.fn(async () => {}) }),
}))

const NO_CHAMAS_COPY = 'Your chamas appear here once you\u2019re part of one.'
const EMPTY_BOOK_COPY = 'No payments yet. The book starts with the first payment in.'
const GROUP_BOOK = `GET /api/chamas/${encodeURIComponent(CHAMA_ADDRESS)}/book`

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

  it('shows the invite button and an empty fund feed for a group with no payments yet', async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [groupWallet()] } },
      'GET /api/memberships': { body: { identity: groupWallet(), members: [], chamas: [] } },
      [GROUP_BOOK]: { body: bookStub() },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    const invite = screen.getByTestId('invite-button')
    expect(invite).toHaveTextContent('Invite members')
    expect(screen.queryByText('Invite someone to contribute')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('book-group')).not.toBeInTheDocument()
    expect(screen.getByText(EMPTY_BOOK_COPY)).toBeInTheDocument()
  })

  it('shows the fund feed with member names for a group with a payment', async () => {
    installConnectedKastle(CHAMA_ADDRESS)
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [groupWallet()] } },
      'GET /api/memberships': { body: { identity: groupWallet(), members: [], chamas: [] } },
      [GROUP_BOOK]: {
        body: bookStub({
          balance_sompi: '100000000',
          rows: [
            {
              direction: 'in',
              amount_sompi: '100000000',
              other_address: USER_ADDRESS,
              other_name: 'Amina',
              other_kind: 'user',
              date: 1_700_000_000_000,
              txid: 'ab'.repeat(32),
              other_is_member: true,
            },
          ],
        }),
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByTestId('invite-button')).toBeInTheDocument()
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