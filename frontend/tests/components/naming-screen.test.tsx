import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Wallet } from '../../../shared/types'
import { NamingScreen } from '../../src/components/NamingScreen'
import { RegistryProvider } from '../../src/wallet/registry'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const REGISTERED: Wallet = {
  address: USER_ADDRESS,
  name: 'Amina',
  kind: 'user',
  created_at: 1_700_000_000_000,
}

function renderScreen(): void {
  render(
    <WalletProvider>
      <RegistryProvider>
        <NamingScreen />
      </RegistryProvider>
    </WalletProvider>,
  )
}

describe('NamingScreen', () => {
  beforeEach(() => {
    installConnectedKastle()
    stubApi({ 'GET /api/wallets/resolve': { body: { wallets: [] } } })
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the exact name prompt and kind question copy', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByTestId('naming-name-input')).toBeInTheDocument())
    expect(screen.getByText('Give this wallet a name.')).toBeInTheDocument()
    expect(
      screen.getByText('Is this wallet yours, or a group\u2019s?'),
    ).toBeInTheDocument()
    expect(screen.getByText('This is me')).toBeInTheDocument()
    expect(screen.getByText('This is a group')).toBeInTheDocument()
  })

  it('preselects nothing and keeps continue disabled until a kind is chosen', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('kind-option-user')).toBeInTheDocument())

    expect(screen.getByTestId('kind-option-user')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('kind-option-group')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('naming-submit')).toBeDisabled()

    await userEvent.click(screen.getByTestId('kind-option-user'))
    expect(screen.getByTestId('kind-option-user')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('naming-submit')).toBeEnabled()
  })

  it('rejects a name shorter than 2 characters with the exact copy and no API call', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('naming-name-input')).toBeInTheDocument())

    await userEvent.type(screen.getByTestId('naming-name-input'), 'a')
    await userEvent.click(screen.getByTestId('kind-option-user'))
    await userEvent.click(screen.getByTestId('naming-submit'))

    expect(screen.getByTestId('naming-name-error')).toHaveTextContent(
      'Names are between 2 and 20 characters.',
    )
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/wallets/register'),
      expect.anything(),
    )
  })

  it('rejects a name with control characters', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('naming-name-input')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('naming-name-input'), { target: { value: 'Am\u0001ina' } })
    await userEvent.click(screen.getByTestId('kind-option-user'))
    await userEvent.click(screen.getByTestId('naming-submit'))

    expect(screen.getByTestId('naming-name-error')).toHaveTextContent(
      'Names are between 2 and 20 characters.',
    )
  })

  it('registers the trimmed name and kind, then shows the success copy', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [] } },
      'POST /api/wallets/register': { status: 201, body: { wallet: REGISTERED } },
    })
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('naming-name-input')).toBeInTheDocument())

    await userEvent.type(screen.getByTestId('naming-name-input'), '  Amina  ')
    await userEvent.click(screen.getByTestId('kind-option-user'))
    await userEvent.click(screen.getByTestId('naming-submit'))

    await waitFor(() => expect(screen.getByTestId('naming-success-copy')).toBeInTheDocument())
    expect(screen.getByTestId('naming-success-copy')).toHaveTextContent(
      'You\u2019re all set, Amina.',
    )
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/wallets/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Amina', kind: 'user' }),
      }),
    )
  })

  it('shows the backend error message when registration fails', async () => {
    stubApi({
      'GET /api/wallets/resolve': { body: { wallets: [] } },
      'POST /api/wallets/register': {
        status: 409,
        body: { error: { kind: 'conflict', message: 'This wallet is already named' } },
      },
    })
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('naming-name-input')).toBeInTheDocument())

    await userEvent.type(screen.getByTestId('naming-name-input'), 'Amina')
    await userEvent.click(screen.getByTestId('kind-option-user'))
    await userEvent.click(screen.getByTestId('naming-submit'))

    await waitFor(() => expect(screen.getByTestId('naming-error')).toBeInTheDocument())
    expect(screen.getByTestId('naming-error')).toHaveTextContent('This wallet is already named')
  })
})