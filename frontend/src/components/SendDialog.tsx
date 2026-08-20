import { useEffect, useRef, useState } from 'react'
import type { RosterMember } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { kasToSompi, shortAddress, shortTxid, sompiToKas } from '../format'
import { logger } from '../logger'
import { extractSignedTx, EXPECTED_NETWORK, isUserRejection } from '../wallet/kastle'
import { useToast } from './Toaster'

export type SendPhase =
  | { name: 'member' }
  | { name: 'amount'; member: RosterMember }
  | { name: 'review'; member: RosterMember; kas: string; sompi: string }
  | { name: 'preparing' }
  | { name: 'signing' }
  | { name: 'pending'; txid: string }
  | { name: 'sent' }
  | { name: 'failed' }
  | { name: 'error'; message: string }

interface SendDialogProps {
  fundAddress: string
  members: RosterMember[]
  onClose: () => void
  onSent: () => void
}

function memberLabel(member: RosterMember): string {
  return member.name ?? shortAddress(member.address)
}

export function SendDialog({ fundAddress, members, onClose, onSent }: SendDialogProps): JSX.Element {
  const [phase, setPhase] = useState<SendPhase>({ name: 'member' })
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    if (phase.name === 'amount') firstFieldRef.current?.focus()
  }, [phase])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (phase.name === 'member' || phase.name === 'amount' || phase.name === 'review') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, onClose])

  const handlePickMember = (member: RosterMember): void => {
    setAmount('')
    setAmountError(null)
    setPhase({ name: 'amount', member })
  }

  const handleReview = (): void => {
    if (phase.name !== 'amount') return
    try {
      const sompi = kasToSompi(amount)
      const kas = sompiToKas(sompi)
      setAmountError(null)
      setPhase({ name: 'review', member: phase.member, kas, sompi })
    } catch (err) {
      setAmountError(err instanceof Error ? err.message : 'Enter an amount to send.')
    }
  }

  const handleApprove = async (): Promise<void> => {
    if (phase.name !== 'review') return
    const { member, kas, sompi } = phase
    setPhase({ name: 'preparing' })
    try {
      const { signing_template } = await apiClient.prepareWithdrawal({
        fund_address: fundAddress,
        recipient_address: member.address,
        amount_sompi: sompi,
      })
      logger.info('withdrawal template prepared', {
        fundAddress,
        recipientAddress: member.address,
        amountSompi: sompi,
      })

      if (!window.kastle) {
        setPhase({ name: 'failed' })
        return
      }
      setPhase({ name: 'signing' })
      const signedRaw = await window.kastle.signTx(EXPECTED_NETWORK, signing_template)
      const signed = extractSignedTx(signedRaw)
      if (!signed) {
        logger.warn('wallet returned no signed transaction', {
          fundAddress,
          recipientAddress: member.address,
          amountSompi: sompi,
        })
        setPhase({ name: 'review', member, kas, sompi })
        return
      }

      const { status, txid } = await apiClient.finalizeWithdrawal({
        fund_address: fundAddress,
        recipient_address: member.address,
        amount_sompi: sompi,
        signed,
      })
      logger.info('withdrawal sent', {
        fundAddress,
        recipientAddress: member.address,
        amountSompi: sompi,
        txid,
        status,
      })
      if (status === 'recorded') {
        setPhase({ name: 'sent' })
      } else {
        setPhase({
          name: 'pending',
          txid,
        })
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 0) {
        logger.warn('withdrawal network error', {
          fundAddress,
          amountSompi: sompi,
          message: err.message,
        })
        setPhase({ name: 'error', message: err.message })
      } else if (err instanceof ApiClientError) {
        logger.warn('withdrawal rejected', {
          status: err.status,
          message: err.message,
          fundAddress,
          recipientAddress: member.address,
          amountSompi: sompi,
        })
        setPhase({ name: 'failed' })
      } else if (isUserRejection(err)) {
        logger.warn('signing declined', { fundAddress, recipientAddress: member.address, amountSompi: sompi })
        showToast({ message: 'Signing cancelled.', kind: 'info' })
        setPhase({ name: 'review', member, kas, sompi })
      } else {
        logger.warn('signing failed', {
          error: err instanceof Error ? err.message : String(err),
          fundAddress,
          recipientAddress: member.address,
          amountSompi: sompi,
        })
        setPhase({ name: 'error', message: 'Couldn\u2019t sign. Try again.' })
      }
    }
  }

  const handleRecorded = (): void => {
    onSent()
    onClose()
  }

  return (
    <div className="overlay" role="presentation" data-testid="send-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Send to someone in the chama"
        data-testid="send-dialog-panel"
      >
        {phase.name === 'member' && (
          <div className="send-member">
            <h2 className="dialog-title">Send to someone in the chama</h2>
            {members.length === 0 ? (
              <p className="dialog-copy" data-testid="send-no-members">
                Add people to the chama first. You can only send to members.
              </p>
            ) : (
              <ul className="send-member-list" data-testid="send-member-list">
                {members.map((member) => (
                  <li key={member.address}>
                    <button
                      className="button button-secondary button-full"
                      onClick={() => handlePickMember(member)}
                      data-testid="send-member-option"
                    >
                      {memberLabel(member)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={onClose} data-testid="send-cancel">
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase.name === 'amount' && (
          <div className="send-amount">
            <h2 className="dialog-title">Send to {memberLabel(phase.member)}</h2>
            <label className="join-form-label" htmlFor="send-amount">
              How much?
            </label>
            <input
              id="send-amount"
              ref={firstFieldRef}
              className="input input-mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              aria-invalid={amountError !== null}
              data-testid="send-amount-input"
            />
            {amountError ? (
              <p className="field-error" role="alert" data-testid="send-amount-error">
                {amountError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                onClick={() => setPhase({ name: 'member' })}
                data-testid="send-back"
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={handleReview}
                disabled={amount.trim() === ''}
                data-testid="send-next"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {phase.name === 'review' && (
          <div className="send-review">
            <h2 className="dialog-title">
              Send {phase.kas} KAS to {memberLabel(phase.member)}?
            </h2>
            <p className="dialog-copy send-warning" data-testid="send-warning">
              This moves money out of the chama. Every member will see it in the book. It
              can&rsquo;t be undone.
            </p>
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                onClick={() => setPhase({ name: 'amount', member: phase.member })}
                data-testid="send-back"
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={() => void handleApprove()}
                data-testid="send-approve"
              >
                Approve
              </button>
            </div>
          </div>
        )}

        {(phase.name === 'preparing' || phase.name === 'signing') && (
          <div className="pay-waiting" data-testid="send-waiting">
            <div className="spinner" aria-hidden="true" />
            <p className="pay-waiting-copy">
              {phase.name === 'preparing'
                ? 'Preparing the payment...'
                : 'Confirm in your wallet...'}
            </p>
          </div>
        )}

        {phase.name === 'pending' && (
          <div className="pay-outcome" data-testid="send-pending">
            <div className="status-icon status-icon-ok" aria-hidden="true">
              ✓
            </div>
            <h2 className="dialog-title">Still confirming…</h2>
            <p className="dialog-copy">
              It hasn't been permanently recorded yet. It will appear in the book once it's confirmed.
            </p>
            {shortTxid(phase.txid)}
            <button
              className="button button-primary button-full"
              onClick={handleRecorded}
              data-testid="send-back-to-book"
            >
              Back to the chama
            </button>
          </div>
        )}

        {phase.name === 'sent' && (
          <div className="pay-outcome" data-testid="send-sent">
            <div className="status-icon status-icon-ok" aria-hidden="true">
              ✓
            </div>
            <h2 className="dialog-title">Payment sent.</h2>
            <p className="dialog-copy">It's on the book, permanent and verifiable.</p>
            <button
              className="button button-primary button-full"
              onClick={handleRecorded}
              data-testid="send-back-to-book"
            >
              Back to the chama
            </button>
          </div>
        )}

        {phase.name === 'failed' && (
          <div className="pay-outcome" data-testid="send-failed">
            <div className="status-icon status-icon-error" aria-hidden="true">
              ✗
            </div>
            <h2 className="dialog-title">Payment didn't go through</h2>
            <p className="dialog-copy">
              Nothing was sent and nothing is in the book.
            </p>
            <button
              className="button button-primary button-full"
              onClick={onClose}
              data-testid="send-failed-close"
            >
              Close
            </button>
          </div>
        )}

        {phase.name === 'error' && (
          <div className="pay-outcome" data-testid="send-error">
            <div className="status-icon status-icon-error" aria-hidden="true">
              ✗
            </div>
            <h2 className="dialog-title">Something went wrong</h2>
            <p className="dialog-copy">{phase.message}</p>
            <button
              className="button button-primary button-full"
              onClick={onClose}
              data-testid="send-error-close"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}