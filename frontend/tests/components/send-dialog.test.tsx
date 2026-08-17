import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterMember } from '../../../shared/types'
import { SendDialog } from '../../src/components/SendDialog'
import { ToastProvider } from '../../src/components/Toaster'
import { installConnectedKastle, stubApi, uninstallKastle, USER_ADDRESS } from '../helpers'

const FUND = 'kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8'

const MEMBERS: RosterMember[] = [
  { address: USER_ADDRESS, name: 'Amina', kind: 'user' },
]

function renderDialog(members: RosterMember[] = MEMBERS): void {
  render(
    <ToastProvider>
      <SendDialog
        fundAddress={FUND}
        members={members}
        onClose={() => undefined}
        onSent={() => undefined}
      />
    </ToastProvider>,
  )
}

describe('SendDialog', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists the members as send targets', () => {
    renderDialog()
    expect(screen.getByTestId('send-member-list')).toBeInTheDocument()
    expect(screen.getByTestId('send-member-option')).toHaveTextContent('Amina')
  })

  it('shows a no-members notice when the roster is empty', () => {
    renderDialog([])
    expect(screen.getByTestId('send-no-members')).toBeInTheDocument()
    expect(screen.queryByTestId('send-member-option')).not.toBeInTheDocument()
  })

  it('moves through member → amount → review and shows the irreversible warning', async () => {
    renderDialog()
    await userEvent.click(screen.getByTestId('send-member-option'))
    expect(screen.getByTestId('send-amount-input')).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('send-amount-input'), '10')
    await userEvent.click(screen.getByTestId('send-next'))

    expect(screen.getByText('Send 10 KAS to Amina?')).toBeInTheDocument()
    expect(screen.getByTestId('send-warning')).toHaveTextContent(
      'This moves money out of the fund. Every member will see it in the book. It can\u2019t be undone.',
    )
  })

  it('approves a withdrawal and reports it sent', async () => {
    stubApi({
      'POST /api/withdrawals/prepare': { body: { signing_template: '{"version":0}' } },
      'POST /api/withdrawals/finalize': {
        body: { status: 'recorded', txid: 'ab'.repeat(32) },
      },
    })
    renderDialog()
    await userEvent.click(screen.getByTestId('send-member-option'))
    await userEvent.type(screen.getByTestId('send-amount-input'), '10')
    await userEvent.click(screen.getByTestId('send-next'))
    await userEvent.click(screen.getByTestId('send-approve'))

    await waitFor(() => expect(screen.getByTestId('send-sent')).toBeInTheDocument())

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/withdrawals/finalize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fund_address: FUND,
          recipient_address: USER_ADDRESS,
          amount_sompi: '1000000000',
          signed: 'signed-tx',
        }),
      }),
    )
  })

  it('shows a failed verdict when the node rejects the withdrawal', async () => {
    stubApi({
      'POST /api/withdrawals/prepare': { body: { signing_template: '{"version":0}' } },
      'POST /api/withdrawals/finalize': {
        status: 422,
        body: { error: { kind: 'policy', message: 'Only members can receive money from this fund.' } },
      },
    })
    renderDialog()
    await userEvent.click(screen.getByTestId('send-member-option'))
    await userEvent.type(screen.getByTestId('send-amount-input'), '10')
    await userEvent.click(screen.getByTestId('send-next'))
    await userEvent.click(screen.getByTestId('send-approve'))

    await waitFor(() => expect(screen.getByTestId('send-failed')).toBeInTheDocument())
  })

  it('returns to the member list from the amount step', async () => {
    renderDialog()
    await userEvent.click(screen.getByTestId('send-member-option'))
    expect(screen.getByTestId('send-amount-input')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('send-back'))
    expect(screen.getByTestId('send-member-list')).toBeInTheDocument()
  })
})
