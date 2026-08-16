import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../src/components/Toaster'
import { HomePage } from '../../src/pages/HomePage'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import { CHAMA_ADDRESS, installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const NO_GROUPS_COPY = 'Join your first group — enter the code your group shared with you.'

function renderHome(): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <HomePage />
      </WalletProvider>
    </ToastProvider>,
  )
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

  it('shows the no-groups copy when the user has no chamas', async () => {
    stubApi({ 'GET /api/memberships': { body: { memberships: [] } } })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.getByText(NO_GROUPS_COPY)).toBeInTheDocument()
    expect(screen.getByTestId('join-form')).toBeInTheDocument()
  })

  it('lists the joined chamas', async () => {
    stubApi({
      'GET /api/memberships': {
        body: { memberships: [{ user_address: USER_ADDRESS, chama_address: CHAMA_ADDRESS, created_at: 1_700_000_000_000 }] },
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    expect(screen.getByText('Your chamas')).toBeInTheDocument()
  })

  it('adds a group that appears immediately after a valid join', async () => {
    const memberships: Array<{
      user_address: string
      chama_address: string
      created_at: number
    }> = []
    stubApi({
      'GET /api/memberships': { body: () => ({ memberships }) },
      'POST /api/memberships': {
        status: 201,
        body: () => {
          memberships.push({
            user_address: USER_ADDRESS,
            chama_address: CHAMA_ADDRESS,
            created_at: 1_700_000_000_000,
          })
          return { outcome: 'joined', membership: memberships[0] }
        },
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('join-code-input')).toBeInTheDocument())
    const input = screen.getByTestId('join-code-input')
    await userEvent.type(input, CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memberships'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the invalid-code copy when the backend rejects the code', async () => {
    stubApi({
      'GET /api/memberships': { body: { memberships: [] } },
      'POST /api/memberships': { status: 422, body: { outcome: 'invalid-code' } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('join-code-input')).toBeInTheDocument())
    await userEvent.type(screen.getByTestId('join-code-input'), 'not-a-code')
    await userEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() =>
      expect(
        screen.getByText("That code isn't valid. Check it with your group and try again."),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('group-card')).not.toBeInTheDocument()
  })

  it('asks for a code when the field is submitted empty', async () => {
    stubApi({ 'GET /api/memberships': { body: { memberships: [] } } })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('join-code-input')).toBeInTheDocument())
    await userEvent.type(screen.getByTestId('join-code-input'), '   ')
    await userEvent.click(screen.getByTestId('join-submit'))
    expect(screen.getByText('Enter your group\u2019s code')).toBeInTheDocument()
  })

  it('removes a group after the confirmation copy', async () => {
    stubApi({
      'GET /api/memberships': {
        body: {
          memberships: [
            { user_address: USER_ADDRESS, chama_address: CHAMA_ADDRESS, created_at: 1_700_000_000_000 },
          ],
        },
      },
      'DELETE /api/memberships': { body: { outcome: 'left' } },
    })
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    await userEvent.click(screen.getByTestId('remove-group-button'))

    const dialog = screen.getByTestId('confirm-dialog-panel')
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        /Remove .+ from your home screen\? The book is still there — you can rejoin with the code\./,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('confirm-confirm'))
    await waitFor(() => expect(screen.queryAllByTestId('group-card')).toHaveLength(0))
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memberships'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('keeps the group when removal is cancelled', async () => {
    stubApi({
      'GET /api/memberships': {
        body: {
          memberships: [
            { user_address: USER_ADDRESS, chama_address: CHAMA_ADDRESS, created_at: 1_700_000_000_000 },
          ],
        },
      },
    })
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(1))
    await userEvent.click(screen.getByTestId('remove-group-button'))
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('group-card')).toHaveLength(1)
  })

  it('shows an error state when loading memberships fails', async () => {
    stubApi({
      'GET /api/memberships': { status: 503, body: { error: { kind: 'network', message: 'The server is unreachable.' } } },
    })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('home-error')).toBeInTheDocument())
    expect(screen.getByText('The server is unreachable.')).toBeInTheDocument()
  })
})
