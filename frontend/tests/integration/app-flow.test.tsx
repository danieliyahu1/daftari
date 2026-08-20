import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BookRow, Wallet } from '../../../shared/types'
import App from '../../src/App'
import { CHAMA_ADDRESS, installConnectedKastle, uninstallKastle, USER_ADDRESS } from '../helpers'

function safeEncode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)))
  } catch {
    return ''
  }
}

function setupBackend(options: { named?: boolean } = {}): void {
  const rows: BookRow[] = []
  const wallets = new Map<string, Wallet>()
  const memberships = new Map<string, Set<string>>()
  if (options.named !== false) {
    wallets.set(USER_ADDRESS, {
      address: USER_ADDRESS,
      name: 'Amina',
      kind: 'user',
      created_at: 1_700_000_000_000,
    })
  }
  wallets.set(CHAMA_ADDRESS, {
    address: CHAMA_ADDRESS,
    name: 'Plot',
    kind: 'group',
    created_at: 1_700_000_000_000,
  })
  const TXID = 'dd'.repeat(32)
  let balance = 0n

  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const parsed = new URL(url, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = parsed.pathname
    let body: Record<string, unknown> = {}
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body)) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    const rawHeaders = init?.headers as Record<string, string> | undefined
    const authHeader = rawHeaders?.['Authorization']
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const authedUser = bearer ? safeDecode(bearer) : ''
    const json = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (method === 'POST' && path === '/api/auth/challenge') {
      const address = String(body.address ?? '')
      return json(200, {
        nonce: 'n',
        message: [
          'Daftari wants you to sign in with your Kaspa account:',
          address,
          '',
          "I'm signing into Daftari.",
          '',
          'URI: http://localhost:5173',
          'Version: 1',
          'Chain ID: testnet-10',
          'Nonce: n',
          'Issued At: 2026-01-01T00:00:00.000Z',
        ].join('\n'),
      })
    }
    if (method === 'POST' && path === '/api/auth/session') {
      const message = String(body.message ?? '')
      const address = message.split('\n')[1]?.trim() ?? ''
      return json(200, { token: safeEncode(address), expires_in_seconds: 900 })
    }
    if (method === 'GET' && path === '/api/wallets/resolve') {
      const addresses = (parsed.searchParams.get('addresses') ?? '').split(',').filter(Boolean)
      return json(200, { wallets: addresses.map((a) => wallets.get(a)).filter(Boolean) })
    }
    if (method === 'POST' && path === '/api/wallets/register') {
      const wallet: Wallet = {
        address: authedUser,
        name: String(body.name ?? ''),
        kind: body.kind === 'group' ? 'group' : 'user',
        created_at: 1_700_000_000_000,
      }
      wallets.set(wallet.address, wallet)
      return json(201, { wallet })
    }
    if (method === 'GET' && path === '/api/memberships') {
      const user = authedUser
      const identity = wallets.get(user) ?? null
      if (!identity) return json(200, { identity: null, members: [], chamas: [] })
      if (identity.kind === 'group') {
        const memberAddrs = [...(memberships.get(user) ?? [])]
        const members = memberAddrs.map((addr) => {
          const w = wallets.get(addr)
          return w ? { address: w.address, name: w.name, kind: w.kind } : { address: addr }
        })
        return json(200, { identity, members, chamas: [] })
      }
      const chamas: Array<{ address: string; name: string; kind: string }> = []
      for (const [chama, memberSet] of memberships) {
        if (memberSet.has(user)) {
          const w = wallets.get(chama)
          if (w && w.kind === 'group') {
            chamas.push({ address: w.address, name: w.name, kind: w.kind })
          }
        }
      }
      return json(200, { identity, members: [], chamas })
    }
    if (method === 'POST' && path === '/api/memberships') {
      const chama = String(body.group_address ?? '')
      const member = String(body.member_address ?? '')
      const group = wallets.get(chama)
      if (!group || group.kind !== 'group') {
        return json(422, { error: { kind: 'invalid', message: "This isn't a registered group." } })
      }
      if (!rows.some((r) => r.other_address === member)) {
        return json(422, { error: { kind: 'invalid', message: "This wallet hasn't paid into the chama." } })
      }
      memberships.set(chama, new Set([...(memberships.get(chama) ?? []), member]))
      return json(201, {
        membership: { user_address: member, chama_address: chama, created_at: 1_700_000_000_000 },
      })
    }
    if (method === 'GET' && path.startsWith('/api/chamas/') && path.endsWith('/book')) {
      const user = authedUser
      const groupAddr = decodeURIComponent(path.split('/')[3] ?? '')
      const isOwner = user === groupAddr
      const isMember = memberships.get(groupAddr)?.has(user) ?? false
      if (!isOwner && !isMember) {
        return json(422, { error: { kind: 'policy', message: 'Only members can see this chama.' } })
      }
      const isMemberOf = (addr: string) => memberships.get(groupAddr)?.has(addr) ?? false
      return json(200, {
        balance_sompi: balance.toString(),
        rows: rows.map((r) => ({ ...r, other_is_member: isMemberOf(r.other_address) })),
        group: { address: CHAMA_ADDRESS, name: 'Plot', kind: 'group' },
      })
    }
    if (method === 'POST' && path === '/api/payments/prepare') {
      return json(200, { signing_template: '{"version":0}' })
    }
    if (method === 'POST' && path === '/api/payments/finalize') {
      if (body.signed === 'REJECT') {
        return json(422, { error: { kind: 'conflict', message: 'Transaction was rejected by the node' } })
      }
      rows.unshift({
        direction: 'in',
        amount_sompi: '1000000000',
        other_address: USER_ADDRESS,
        other_name: 'Amina',
        other_kind: 'user',
        date: 1_700_000_000_000,
        txid: TXID,
      })
      balance += 1_000_000_000n
      return json(200, { status: 'recorded', txid: TXID })
    }
    if (method === 'POST' && path === '/api/withdrawals/prepare') {
      return json(200, { signing_template: '{"version":0}' })
    }
    if (method === 'POST' && path === '/api/withdrawals/finalize') {
      const fund = String(body.fund_address ?? '')
      const recipient = String(body.recipient_address ?? '')
      const group = wallets.get(fund)
      if (!group || group.kind !== 'group') {
        return json(422, { error: { kind: 'invalid', message: "This isn't a registered group." } })
      }
      if (!(memberships.get(fund)?.has(recipient) ?? false)) {
        return json(422, {
          error: { kind: 'policy', message: 'Only members can receive money from this fund.' },
        })
      }
      const recipientWallet = wallets.get(recipient)
      const amount = BigInt(String(body.amount_sompi ?? '0'))
      rows.unshift({
        direction: 'out',
        amount_sompi: amount.toString(),
        other_address: recipient,
        other_name: recipientWallet?.name,
        other_kind: recipientWallet?.kind,
        date: 1_700_000_000_000,
        txid: 'ee'.repeat(32),
      })
      balance -= amount
      return json(200, { status: 'recorded', txid: 'ee'.repeat(32) })
    }
    return json(404, { error: { kind: 'invalid', message: 'not found' } })
  })
}

function navigateTo(url: string): void {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

describe('whole demo flow — integration', () => {
  beforeEach(() => {
    installConnectedKastle()
  })

  afterEach(() => {
    uninstallKastle()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('a member invites a person to contribute; the person pays in; the group brings them in', async () => {
    setupBackend()
    render(<App />)

    // Connected as Amina (a person): no chamas yet
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(
      screen.getByText('Your chamas appear here once you\u2019re part of one.'),
    ).toBeInTheDocument()

    // Switch to the group wallet (Plot)
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    installConnectedKastle(CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    expect(screen.getByTestId('invite-button')).toBeInTheDocument()

    // The group opens its book and creates an invitation link
    navigateTo(`/groups/${encodeURIComponent(CHAMA_ADDRESS)}`)
    await waitFor(() => expect(screen.getByTestId('book')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('book-balance')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('invite-button'))
    const inviteLink = (screen.getByTestId('invite-link') as HTMLInputElement).value
    await userEvent.click(screen.getByTestId('invite-close'))

    // Amina opens the invitation and pays in — no code, one tap
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    installConnectedKastle(USER_ADDRESS)
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    navigateTo(new URL(inviteLink).pathname)
    await waitFor(() => expect(screen.getByTestId('contribute-group')).toBeInTheDocument())
    expect(screen.getByText('Plot')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('contribute-button'))
    const dialog = screen.getByTestId('pay-dialog-panel')
    await userEvent.type(within(dialog).getByTestId('pay-amount-input'), '10')
    await userEvent.click(within(dialog).getByTestId('pay-next'))
    await userEvent.click(within(dialog).getByTestId('pay-approve'))
    await waitFor(() => expect(within(dialog).getByTestId('pay-sent')).toBeInTheDocument())
    await userEvent.click(within(dialog).getByTestId('pay-back-to-book'))
    await waitFor(() =>
      expect(screen.getByText('Your contribution is in the book.')).toBeInTheDocument(),
    )

    // The group sees Amina's contribution and brings her in
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    installConnectedKastle(CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    navigateTo(`/groups/${encodeURIComponent(CHAMA_ADDRESS)}`)
    await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())
    expect(screen.getByTestId('add-member')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('add-member'))
    await waitFor(() => expect(screen.queryByTestId('add-member')).not.toBeInTheDocument())

    // Back on the group home, the fund feed shows Amina's contribution
    navigateTo('/')
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('book-row')).toBeInTheDocument())
    expect(screen.getByText('Amina')).toBeInTheDocument()

    // The fund sends to a member: pick Amina, send 2 KAS, the book shows the withdrawal
    await waitFor(() => expect(screen.getByTestId('send-button')).toBeEnabled())
    await userEvent.click(screen.getByTestId('send-button'))
    const sendDialog = screen.getByTestId('send-dialog-panel')
    await userEvent.click(within(sendDialog).getByTestId('send-member-option'))
    await userEvent.type(within(sendDialog).getByTestId('send-amount-input'), '2')
    await userEvent.click(within(sendDialog).getByTestId('send-next'))
    await userEvent.click(within(sendDialog).getByTestId('send-approve'))
    await waitFor(() =>
      expect(within(sendDialog).getByTestId('send-sent')).toBeInTheDocument(),
    )
    await userEvent.click(within(sendDialog).getByTestId('send-back-to-book'))
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(2))
    expect(screen.getByTestId('book-balance')).toHaveTextContent('8 KAS')

    // Amina's home now shows Plot, and she can open the book as a member
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    installConnectedKastle(USER_ADDRESS)
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('group-card')).toBeInTheDocument())
    expect(screen.getByText('Plot')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('group-card').querySelector('a')!)
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(2))
    const amounts = screen.getAllByTestId('book-amount').map((el) => el.textContent)
    expect(amounts).toContain('+10 KAS')
    expect(amounts).toContain('−2 KAS')
    expect(screen.queryByTestId('add-member')).not.toBeInTheDocument()
  })

  it('refuses a non-member the book with the member-only copy', async () => {
    setupBackend()
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    navigateTo(`/groups/${encodeURIComponent(CHAMA_ADDRESS)}`)

    await waitFor(() => expect(screen.getByTestId('book-error')).toBeInTheDocument())
    expect(screen.getByText('Only members can see this chama.')).toBeInTheDocument()
  })

  it('registers a first-time wallet and recognizes it on the next sign-in', async () => {
    setupBackend({ named: false })
    render(<App />)

    // Connected but unnamed: the naming gate blocks the app (FR-8)
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('naming-screen')).toBeInTheDocument())
    expect(screen.queryByTestId('home')).not.toBeInTheDocument()

    await userEvent.type(screen.getByTestId('naming-name-input'), 'Amina')
    await userEvent.click(screen.getByTestId('kind-option-user'))
    await userEvent.click(screen.getByTestId('naming-submit'))

    await waitFor(() => expect(screen.getByTestId('naming-success-copy')).toBeInTheDocument())
    expect(screen.getByTestId('naming-success-copy')).toHaveTextContent(
      'You\u2019re all set, Amina.',
    )
    await waitFor(
      () => expect(screen.getByTestId('home-empty')).toBeInTheDocument(),
      { timeout: 3_000 },
    )
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.getByTestId('identity-kind')).toHaveTextContent('person')

    // Disconnect and reconnect: recognized by name, no naming asked again (FR-1/7)
    await userEvent.click(screen.getByTestId('disconnect-button'))
    await waitFor(() => expect(screen.getByTestId('connect-button')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('connect-button'))
    await waitFor(() => expect(screen.getByTestId('wallet-connected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('naming-screen')).not.toBeInTheDocument()
  })
})