import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { BookGroup } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { BackLink } from '../components/BackLink'
import { EmptyState } from '../components/EmptyState'
import { PayDialog } from '../components/PayDialog'
import { logger } from '../logger'
import { useRegistry } from '../wallet/registry'
import { useWallet } from '../wallet/WalletProvider'

const NOT_A_GROUP = "This isn't a registered group."
const NAME_FIRST_COPY = 'Name your wallet in the app before you can join.'

export function ContributePage(): JSX.Element {
  const { code } = useParams<{ code: string }>()
  const wallet = useWallet()
  const auth = useAuth()
  const registry = useRegistry()
  const [group, setGroup] = useState<BookGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [contributed, setContributed] = useState(false)

  const groupCode = code ?? ''

  const load = useCallback(async () => {
    if (!groupCode) return
    setLoading(true)
    setError(null)
    try {
      const { wallets } = await apiClient.resolveWallets([groupCode])
      const found = wallets.find((wallet) => wallet.address === groupCode && wallet.kind === 'group')
      if (!found) {
        logger.warn('contribution refused', { groupCode, reason: 'not-a-registered-group' })
        setError(NOT_A_GROUP)
      } else {
        setGroup({ address: found.address, name: found.name, kind: found.kind })
      }
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to resolve invitation', { error: message })
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [groupCode])

  useEffect(() => {
    void load()
  }, [load])

  const handleRecorded = (): void => {
    setPaying(false)
    setContributed(true)
    logger.info('contribution recorded', { groupCode })
  }

  if (wallet.address === null) {
    return (
      <div className="book" data-testid="contribute">
        <BackLink to="/" label="Your chamas" />
        <EmptyState title="Connect your wallet to contribute.">
          <p className="empty-sub">Your contribution is how you join a chama.</p>
        </EmptyState>
      </div>
    )
  }

  if (auth.status !== 'ready') {
    return (
      <div className="book" data-testid="contribute">
        <BackLink to="/" label="Your chamas" />
        <EmptyState title="Signing you in...">
          {auth.status === 'error' && <p className="empty-sub">{auth.error}</p>}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="book" data-testid="contribute">
      <BackLink to="/" label="Your chamas" />

      {loading ? (
        <div className="loading-container" data-testid="contribute-loading">
          <p>Reading the invitation...</p>
        </div>
      ) : error ? (
        <div className="error-container" data-testid="contribute-error">
          <p>{error}</p>
        </div>
      ) : contributed ? (
        <EmptyState title="Your contribution is in the book.">
          <p className="empty-sub">
            The group will bring you in. The chama appears on your home once it does.
          </p>
        </EmptyState>
      ) : group ? (
        <section className="contribute-card" data-testid="contribute-group">
          <span className="micro-label">You were invited to contribute to</span>
          <span className="book-group-name" title={group.address}>
            {group.name}
          </span>
          <span className="kind-mark">{group.kind === 'group' ? 'group' : 'person'}</span>
          {registry.status === 'named' ? (
            <button
              className="button button-primary button-full"
              onClick={() => setPaying(true)}
              data-testid="contribute-button"
            >
              Pay into {group.name}
            </button>
          ) : (
            <p className="empty-sub" data-testid="contribute-name-first">
              {NAME_FIRST_COPY}
            </p>
          )}
        </section>
      ) : null}

      {paying && wallet.address && (
        <PayDialog
          groupCode={groupCode}
          onClose={() => setPaying(false)}
          onRecorded={handleRecorded}
        />
      )}
    </div>
  )
}