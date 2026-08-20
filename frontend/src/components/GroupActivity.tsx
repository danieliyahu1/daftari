import { useCallback, useEffect, useState } from 'react'
import type { Book, RosterMember } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { PAGE_SIZE } from '../constants'
import { sompiToKas } from '../format'
import { logger } from '../logger'
import { useWallet } from '../wallet/WalletProvider'
import { BookRow } from './BookRow'
import { EmptyState } from './EmptyState'
import { InviteDialog } from './InviteDialog'
import { PayDialog } from './PayDialog'
import { SendDialog } from './SendDialog'

const EMPTY_BOOK_COPY = 'No payments yet. The book starts with the first payment in.'

interface GroupActivityProps {
  groupCode: string
  inviteFirst?: boolean
}

export function GroupActivity({ groupCode, inviteFirst = false }: GroupActivityProps): JSX.Element {
  const wallet = useWallet()
  const auth = useAuth()
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [paying, setPaying] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [sending, setSending] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [members, setMembers] = useState<RosterMember[]>([])

  const ready = auth.status === 'ready'

  const refreshMembers = useCallback(async () => {
    if (!wallet.address || auth.status !== 'ready') return
    try {
      const home = await apiClient.getHome()
      setMembers(home.members)
    } catch (err) {
      logger.warn('failed to load fund members', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [wallet.address, auth.status])

  useEffect(() => {
    if (inviteFirst && wallet.address !== null && ready) void refreshMembers()
  }, [inviteFirst, wallet.address, ready, refreshMembers])

  const load = useCallback(async () => {
    if (!groupCode || auth.status !== 'ready') return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await apiClient.getBook(groupCode, PAGE_SIZE, 0)
      setBook(result)
      setHasMore(result.rows.length === PAGE_SIZE)
      logger.info('book loaded', {
        code: groupCode,
        rows: result.rows.length,
        balance_sompi: result.balance_sompi,
      })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to load book', { error: message })
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [groupCode, auth.status])

  useEffect(() => {
    if (wallet.address !== null && ready) void load()
  }, [load, wallet.address, ready])

  const loadMore = useCallback(async () => {
    if (!groupCode || !book || auth.status !== 'ready') return
    setLoadingMore(true)
    try {
      const result = await apiClient.getBook(groupCode, PAGE_SIZE, book.rows.length)
      setBook((prev) => (prev ? { ...prev, rows: [...prev.rows, ...result.rows] } : prev))
      setHasMore(result.rows.length === PAGE_SIZE)
      logger.info('book rows appended', {
        code: groupCode,
        total: book.rows.length + result.rows.length,
      })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to load more rows', { error: message })
      setLoadError(message)
    } finally {
      setLoadingMore(false)
    }
  }, [groupCode, book, auth.status])

  const isGroup = wallet.address !== null && wallet.address === groupCode

  const handleAdd = useCallback(
    async (memberAddress: string) => {
      setAdding(memberAddress)
      setLoadError(null)
      try {
        await apiClient.addMember({
          group_address: groupCode,
          member_address: memberAddress,
        })
        logger.info('member added to chama', { chamaAddress: groupCode, memberAddress })
        await load()
        if (inviteFirst) void refreshMembers()
      } catch (err) {
        const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
        logger.warn('failed to add member', { error: message })
        setLoadError(message)
      } finally {
        setAdding(null)
      }
    },
    [groupCode, load],
  )

  const canPay = wallet.status === 'connected' && wallet.address !== null && auth.status === 'ready'
  const noWallet =
    wallet.status === 'idle' ||
    wallet.status === 'not-installed' ||
    wallet.status === 'disconnected'

  return (
    <>
      {noWallet ? (
        <EmptyState title="Connect your wallet to see this chama.">
          <p className="empty-sub">Only members can see a chama.</p>
        </EmptyState>
      ) : auth.status !== 'ready' ? (
        <EmptyState title="Signing you in...">
          <p className="empty-sub">{auth.status === 'error' ? auth.error : 'Confirm the sign-in message.'}</p>
        </EmptyState>
      ) : loading ? (
        <div className="loading-container" data-testid="book-loading">
          <p>Reading the book...</p>
        </div>
      ) : loadError ? (
        <div className="error-container" data-testid="book-error">
          <p>{loadError}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : book ? (
        <>
          {inviteFirst && canPay && (
            <div className="activity-invite">
              <button
                className="button button-primary button-full"
                onClick={() => setInviting(true)}
                data-testid="invite-button"
              >
                Invite members
              </button>
              <button
                className="button button-secondary button-full"
                onClick={() => setSending(true)}
                disabled={members.length === 0}
                data-testid="send-button"
              >
                Send to a member
              </button>
              {members.length === 0 ? (
                <p className="activity-hint" data-testid="send-hint">
                  Add members first — the fund can only send to its members.
                </p>
              ) : null}
            </div>
          )}

          {!inviteFirst && (
            <section className="book-header" data-testid="book-group">
              <span className="micro-label">Group</span>
              <span className="book-group-name" title={book.group.address}>
                {book.group.name}
              </span>
              <span className="kind-mark" data-testid="book-group-kind">
                {book.group.kind === 'group' ? 'group' : 'person'}
              </span>
            </section>
          )}

          <section className="balance-card" data-testid="book-balance">
            <span className="micro-label">The group has</span>
            <span className="balance-amount mono">{sompiToKas(book.balance_sompi)} KAS</span>
          </section>

          {book.rows.length === 0 ? (
            <EmptyState title={EMPTY_BOOK_COPY} />
          ) : (
            <>
              <ul className="book-list">
                {book.rows.map((row) => (
                  <BookRow
                    key={row.txid}
                    row={row}
                    onAdd={
                      isGroup && !row.other_is_member && row.other_kind === 'user'
                        ? () => void handleAdd(row.other_address)
                        : undefined
                    }
                    addBusy={adding === row.other_address}
                  />
                ))}
              </ul>
              {hasMore && (
                <button
                  className="button button-secondary button-full load-more"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  data-testid="load-more"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}

          {canPay && (
            <div className="book-actions">
              {!inviteFirst && (
                <button
                  className="button button-secondary button-full"
                  onClick={() => setInviting(true)}
                  data-testid="invite-button"
                >
                  Invite someone to contribute
                </button>
              )}
              {!isGroup && (
                <button
                  className="button button-primary button-full"
                  onClick={() => setPaying(true)}
                  data-testid="pay-button"
                >
                  Pay into the group
                </button>
              )}
            </div>
          )}
        </>
      ) : null}

      {paying && wallet.address && (
        <PayDialog
          groupCode={groupCode}
          onClose={() => setPaying(false)}
          onRecorded={() => void load()}
        />
      )}

      {inviting && <InviteDialog groupCode={groupCode} onClose={() => setInviting(false)} />}

      {sending && (
        <SendDialog
          fundAddress={groupCode}
          members={members}
          onClose={() => setSending(false)}
          onSent={() => void load()}
        />
      )}
    </>
  )
}