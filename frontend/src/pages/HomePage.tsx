import { useCallback, useEffect, useState } from 'react'
import type { BookGroup, Home } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { EmptyState } from '../components/EmptyState'
import { GroupActivity } from '../components/GroupActivity'
import { GroupCard } from '../components/GroupCard'
import { shortAddress } from '../format'
import { logger } from '../logger'
import { useRegistry } from '../wallet/registry'
import { useWallet } from '../wallet/WalletProvider'

const NO_CHAMAS_COPY = 'Your chamas appear here once you\u2019re part of one.'

export function HomePage(): JSX.Element {
  const wallet = useWallet()
  const auth = useAuth()
  const registry = useRegistry()
  const [home, setHome] = useState<Home | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!wallet.address || auth.status !== 'ready') return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await apiClient.getHome()
      setHome(result)
      logger.info('home loaded', {
        kind: result.identity?.kind ?? null,
        members: result.members.length,
        chamas: result.chamas.length,
      })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to load home', { error: message })
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [wallet.address, auth.status])

  useEffect(() => {
    void load()
  }, [load])

  if (wallet.status !== 'connected' || !wallet.address) {
    return (
      <EmptyState title="Connect your wallet to see your chamas.">
        <p className="empty-sub">Your chamas live on the chain, read through your wallet.</p>
      </EmptyState>
    )
  }

  if (auth.status !== 'ready') {
    return (
      <EmptyState title="Signing you in...">
        <p className="empty-sub">{auth.status === 'error' ? auth.error : 'Confirm the sign-in message in Kastle.'}</p>
      </EmptyState>
    )
  }

  const isGroup = home?.identity?.kind === 'group'

  return (
    <div className="home" data-testid="home">
      <section className="profile-header">
        <span className="micro-label">You</span>
        {registry.identity ? (
          <>
            <span className="profile-name" title={registry.identity.address}>
              {registry.identity.name}
            </span>
            <span className="kind-mark" data-testid="identity-kind">
              {registry.identity.kind === 'group' ? 'group' : 'person'}
            </span>
          </>
        ) : (
          <span className="profile-address mono" title={wallet.address}>
            {shortAddress(wallet.address, 10, 6)}
          </span>
        )}
      </section>

      {loading ? (
        <div className="loading-container" data-testid="home-loading">
          <p>Loading your chamas...</p>
        </div>
      ) : loadError ? (
        <div className="error-container" data-testid="home-error">
          <p>{loadError}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : isGroup ? (
        <GroupActivity groupCode={wallet.address} inviteFirst />
      ) : (
        <PersonChamas chamas={home?.chamas ?? []} />
      )}
    </div>
  )
}

function PersonChamas({ chamas }: { chamas: BookGroup[] }): JSX.Element {
  if (chamas.length === 0) {
    return (
      <section className="empty" data-testid="home-empty">
        <EmptyState title={NO_CHAMAS_COPY}>
          <p className="empty-sub">{'A chama you\u2019re part of will appear here.'}</p>
        </EmptyState>
      </section>
    )
  }
  return (
    <section>
      <h2 className="section-title">Your chamas</h2>
      <ul className="group-list">
        {chamas.map((chama) => (
          <GroupCard key={chama.address} code={chama.address} name={chama.name} />
        ))}
      </ul>
    </section>
  )
}