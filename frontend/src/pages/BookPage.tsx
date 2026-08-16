import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Book } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { BackLink } from '../components/BackLink'
import { BookRow } from '../components/BookRow'
import { EmptyState } from '../components/EmptyState'
import { PayDialog } from '../components/PayDialog'
import { PAGE_SIZE } from '../constants'
import { sompiToKas } from '../format'
import { logger } from '../logger'
import { useWallet } from '../wallet/WalletProvider'

const EMPTY_BOOK_COPY = 'No payments yet. The book starts with the first payment in.'

export function BookPage(): JSX.Element {
  const { code } = useParams<{ code: string }>()
  const wallet = useWallet()
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [paying, setPaying] = useState(false)

  const groupCode = code ?? ''

  const load = useCallback(async () => {
    if (!groupCode) return
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
  }, [groupCode])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (!groupCode || !book) return
    setLoadingMore(true)
    try {
      const result = await apiClient.getBook(groupCode, PAGE_SIZE, book.rows.length)
      setBook((prev) =>
        prev ? { balance_sompi: prev.balance_sompi, rows: [...prev.rows, ...result.rows] } : prev,
      )
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
  }, [groupCode, book])

  const canPay = wallet.status === 'connected' && wallet.address !== null

  return (
    <div className="book" data-testid="book">
      <BackLink to="/" label="Your chamas" />

      {loading ? (
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
                  <BookRow key={row.txid} row={row} />
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
              <button
                className="button button-primary button-full"
                onClick={() => setPaying(true)}
                data-testid="pay-button"
              >
                Pay into the group
              </button>
            </div>
          )}
        </>
      ) : null}

      {paying && wallet.address && (
        <PayDialog
          groupCode={groupCode}
          userAddress={wallet.address}
          onClose={() => setPaying(false)}
          onRecorded={() => void load()}
        />
      )}
    </div>
  )
}
