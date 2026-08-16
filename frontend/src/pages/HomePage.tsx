import { useCallback, useEffect, useState } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { GroupCard } from '../components/GroupCard'
import { JoinForm } from '../components/JoinForm'
import { shortAddress } from '../format'
import { logger } from '../logger'
import { useRegistry } from '../wallet/registry'
import { useWallet } from '../wallet/WalletProvider'

const NO_GROUPS_COPY = 'Join your first group — enter the code your group shared with you.'

export function HomePage(): JSX.Element {
  const wallet = useWallet()
  const registry = useRegistry()
  const [memberships, setMemberships] = useState<{ chama_address: string; created_at: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)

  const load = useCallback(async () => {
    if (!wallet.address) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await apiClient.listMemberships(wallet.address)
      setMemberships(result.memberships)
      logger.info('memberships loaded', { count: result.memberships.length })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to load memberships', { error: message })
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [wallet.address])

  useEffect(() => {
    void load()
  }, [load])

  const handleJoined = useCallback(() => {
    void load()
  }, [load])

  const handleRemove = useCallback(async () => {
    if (!removing || !wallet.address) return
    setRemovingBusy(true)
    try {
      await apiClient.leaveMembership({
        user_address: wallet.address,
        chama_address: removing,
      })
      setMemberships((prev) => prev.filter((m) => m.chama_address !== removing))
      setRemoving(null)
      logger.info('group removed', { chamaAddress: removing })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      logger.warn('failed to remove group', { error: message })
      setLoadError(message)
    } finally {
      setRemovingBusy(false)
    }
  }, [removing, wallet.address])

  if (wallet.status !== 'connected' || !wallet.address) {
    return (
      <EmptyState title="Connect your wallet to see your chamas.">
        <p className="empty-sub">Your chamas live on the chain, read through your wallet.</p>
      </EmptyState>
    )
  }

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
      ) : memberships.length === 0 ? (
        <section className="empty" data-testid="home-empty">
          <p className="empty-title">{NO_GROUPS_COPY}</p>
          <JoinForm userAddress={wallet.address} onJoined={handleJoined} />
        </section>
      ) : (
        <section>
          <h2 className="section-title">Your chamas</h2>
          <ul className="group-list">
            {memberships.map((membership) => (
              <GroupCard
                key={membership.chama_address}
                code={membership.chama_address}
                createdAt={membership.created_at}
                onRemove={setRemoving}
              />
            ))}
          </ul>
          <JoinForm userAddress={wallet.address} onJoined={handleJoined} />
        </section>
      )}

      {removing !== null && (
        <ConfirmDialog
          title="Remove this group?"
          message={`Remove ${shortAddress(removing, 10, 6)} from your home screen? The book is still there — you can rejoin with the code.`}
          confirmLabel="Remove"
          busy={removingBusy}
          onConfirm={() => void handleRemove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
