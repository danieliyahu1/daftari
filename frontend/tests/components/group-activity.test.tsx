import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupActivity } from '../../src/components/GroupActivity'
import { ToastProvider } from '../../src/components/Toaster'
import { WalletProvider } from '../../src/wallet/WalletProvider'
import {
  bookStub,
  CHAMA_ADDRESS,
  installConnectedKastle,
  installDisconnectedKastle,
  stubApi,
  uninstallKastle,
  USER_ADDRESS,
} from '../helpers'

vi.mock('../../src/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', error: null, address: USER_ADDRESS, signIn: vi.fn(async () => {}) }),
}))

const BOOK_PATH = `GET /api/chamas/${encodeURIComponent(CHAMA_ADDRESS)}/book`

const TXID = 'ab'.repeat(32)

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    direction: 'in',
    amount_sompi: '100000000',
    other_address: USER_ADDRESS,
    date: 1_700_000_000_000,
    txid: TXID,
    ...overrides,
  }
}

function renderActivity(props: { groupCode?: string; inviteFirst?: boolean } = {}): void {
  render(
    <ToastProvider>
      <WalletProvider>
        <GroupActivity
          groupCode={props.groupCode ?? CHAMA_ADDRESS}
          inviteFirst={props.inviteFirst}
        />
      </WalletProvider>
    </ToastProvider>,
  )
}

describe('GroupActivity', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('as the fund home (inviteFirst)', () => {
    beforeEach(() => {
      installConnectedKastle(CHAMA_ADDRESS)
    })

    it('shows one prominent Invite members button above the feed', async () => {
      stubApi({ [BOOK_PATH]: { body: bookStub() } })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())

      const invites = screen.getAllByTestId('invite-button')
      expect(invites).toHaveLength(1)
      expect(invites[0]).toHaveTextContent('Invite members')
      expect(screen.queryByText('Invite someone to contribute')).not.toBeInTheDocument()
    })

    it('hides the book header and the pay action for the fund itself', async () => {
      stubApi({ [BOOK_PATH]: { body: bookStub({ rows: [makeRow()] }) } })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())

      expect(screen.queryByTestId('pay-button')).not.toBeInTheDocument()
    })

    it('shows the empty-book copy with the balance when there are no payments', async () => {
      stubApi({ [BOOK_PATH]: { body: bookStub() } })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())

      expect(screen.getByTestId('book-balance')).toHaveTextContent('0 KAS')
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(
        screen.getByText('No payments yet. The book starts with the first payment in.'),
      ).toBeInTheDocument()
    })

    it('disables Send to a member with a hint until the fund has members', async () => {
      stubApi({
        [BOOK_PATH]: { body: bookStub() },
        'GET /api/memberships': {
          body: { identity: { address: CHAMA_ADDRESS, name: 'Plot', kind: 'group', created_at: 0 }, members: [], chamas: [] },
        },
      })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('send-button')).toBeInTheDocument())

      const send = screen.getByTestId('send-button')
      expect(send).toBeDisabled()
      expect(send).toHaveTextContent('Send to a member')
      expect(screen.getByTestId('send-hint')).toBeInTheDocument()
    })

    it('opens the send dialog listing the fund members', async () => {
      stubApi({
        [BOOK_PATH]: { body: bookStub() },
        'GET /api/memberships': {
          body: {
            identity: { address: CHAMA_ADDRESS, name: 'Plot', kind: 'group', created_at: 0 },
            members: [{ address: USER_ADDRESS, name: 'Amina', kind: 'user' }],
            chamas: [],
          },
        },
      })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('send-button')).toBeEnabled())
      await userEvent.click(screen.getByTestId('send-button'))

      expect(screen.getByTestId('send-dialog-panel')).toBeInTheDocument()
      expect(screen.getByTestId('send-member-option')).toHaveTextContent('Amina')
    })

    it('recovers from a failed load with the retry button', async () => {
      let failed = false
      stubApi({
        [BOOK_PATH]: {
          body: () => {
            if (!failed) {
              failed = true
              return new Response('', { status: 503 })
            }
            return bookStub()
          },
        },
      })
      renderActivity({ inviteFirst: true })
      await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
      await userEvent.click(screen.getByText('Try again'))
      await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    })
  })

  describe('as the group book (default)', () => {
    it('shows the group name in the balance card and the invite action at the bottom', async () => {
      stubApi({ [BOOK_PATH]: { body: bookStub() } })
      renderActivity()
      await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())

      expect(screen.getByTestId('book-balance')).toHaveTextContent('Plot')
      expect(screen.getByTestId('invite-button')).toHaveTextContent(
        'Invite someone to contribute',
      )
    })

    it('offers the pay action to a member who is not the group', async () => {
      stubApi({ [BOOK_PATH]: { body: bookStub() } })
      renderActivity()
      await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
      expect(screen.getByTestId('pay-button')).toBeInTheDocument()
    })

    it('renders every row with the party name, amount, date, and proof', async () => {
      stubApi({
        [BOOK_PATH]: {
          body: bookStub({
            rows: [makeRow({ other_name: 'Amina', other_kind: 'user' })],
          }),
        },
      })
      renderActivity()
      await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())

      const row = screen.getByTestId('book-row')
      expect(row).toHaveTextContent('+1')
      expect(row).toHaveTextContent('Amina')
      const proof = row.querySelector('[data-testid="book-proof"]')
      expect(proof).toHaveAttribute('title', TXID)
    })

    it('refuses to render the feed when the wallet is not connected', async () => {
      installDisconnectedKastle()
      stubApi({ [BOOK_PATH]: { body: bookStub() } })
      renderActivity()
      await waitFor(
        () =>
          expect(screen.getByText('Connect to see this chama.')).toBeInTheDocument(),
        { timeout: 1_500 },
      )
      expect(screen.queryByTestId('book-loading')).not.toBeInTheDocument()
    })

    it('surfaces the member-only refusal from the server', async () => {
      stubApi({
        [BOOK_PATH]: {
          status: 422,
          body: { error: { kind: 'policy', message: 'Only members can see this chama.' } },
        },
      })
      renderActivity()
      await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
      expect(screen.getByText('Only members can see this chama.')).toBeInTheDocument()
    })
  })
})