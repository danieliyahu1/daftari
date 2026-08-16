import { useEffect, useRef, useState } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { kasToSompi, shortAddress, sompiToKas } from '../format'
import { logger } from '../logger'
import { extractSignedTx, EXPECTED_NETWORK, isUserRejection } from '../wallet/kastle'
import { useToast } from './Toaster'

export type PayPhase =
  | { name: 'amount' }
  | { name: 'review'; kas: string; sompi: string }
  | { name: 'preparing' }
  | { name: 'signing' }
  | { name: 'sent' }
  | { name: 'failed' }
  | { name: 'error'; message: string }

interface PayDialogProps {
  groupCode: string
  userAddress: string
  onClose: () => void
  onRecorded: () => void
}

export function PayDialog({ groupCode, userAddress, onClose, onRecorded }: PayDialogProps): JSX.Element {
  const [phase, setPhase] = useState<PayPhase>({ name: 'amount' })
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (phase.name === 'amount' || phase.name === 'review') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase.name, onClose])

  const handleReview = (): void => {
    try {
      const sompi = kasToSompi(amount)
      const kas = sompiToKas(sompi)
      setAmountError(null)
      setPhase({ name: 'review', kas, sompi })
    } catch (err) {
      setAmountError(err instanceof Error ? err.message : 'Enter an amount to pay.')
    }
  }

  const handleApprove = async (): Promise<void> => {
    if (phase.name !== 'review') return
    const { kas, sompi } = phase
    setPhase({ name: 'preparing' })
    try {
      const { signing_template } = await apiClient.preparePayment({
        user_address: userAddress,
        chama_address: groupCode,
        amount_sompi: sompi,
      })
      logger.info('payment template prepared', { chamaAddress: groupCode, amountSompi: sompi })

      if (!window.kastle) {
        setPhase({ name: 'failed' })
        return
      }
      setPhase({ name: 'signing' })
      const signedRaw = await window.kastle.signTx(EXPECTED_NETWORK, signing_template)
      const signed = extractSignedTx(signedRaw)
      if (!signed) {
        logger.warn('wallet returned no signed transaction', { chamaAddress: groupCode, amountSompi: sompi })
        setPhase({ name: 'review', kas, sompi })
        return
      }

      const { txid } = await apiClient.finalizePayment({ signed })
      logger.info('payment sent', { chamaAddress: groupCode, amountSompi: sompi, txid })
      setPhase({ name: 'sent' })
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 0) {
        logger.warn('payment network error', { chamaAddress: groupCode, amountSompi: sompi, message: err.message })
        setPhase({ name: 'error', message: err.message })
      } else if (err instanceof ApiClientError) {
        logger.warn('payment rejected', { status: err.status, message: err.message, chamaAddress: groupCode, amountSompi: sompi })
        setPhase({ name: 'failed' })
      } else if (isUserRejection(err)) {
        logger.warn('signing declined', { chamaAddress: groupCode, amountSompi: sompi })
        showToast({ message: 'Signing cancelled.', kind: 'info' })
        setPhase({ name: 'review', kas, sompi })
      } else {
        logger.warn('signing failed', { error: err instanceof Error ? err.message : String(err), chamaAddress: groupCode, amountSompi: sompi })
        setPhase({ name: 'error', message: 'Kastle couldn\u2019t sign the payment. Try again.' })
      }
    }
  }

  const handleRecorded = (): void => {
    onRecorded()
    onClose()
  }

  return (
    <div className="overlay" role="presentation" data-testid="pay-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Pay into the group"
        data-testid="pay-dialog-panel"
      >
        {phase.name === 'amount' && (
          <div className="pay-amount">
            <h2 className="dialog-title">Pay into the group</h2>
            <label className="join-form-label" htmlFor="pay-amount">
              Amount in KAS
            </label>
            <input
              id="pay-amount"
              ref={firstFieldRef}
              className="input input-mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              aria-invalid={amountError !== null}
              data-testid="pay-amount-input"
            />
            {amountError ? (
              <p className="field-error" role="alert" data-testid="pay-amount-error">
                {amountError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={onClose} data-testid="pay-cancel">
                Back
              </button>
              <button
                className="button button-primary"
                onClick={handleReview}
                disabled={amount.trim() === ''}
                data-testid="pay-next"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {phase.name === 'review' && (
          <div className="pay-review">
            <h2 className="dialog-title">
              Pay {phase.kas} KAS into {shortAddress(groupCode, 10, 6)}?
            </h2>
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                onClick={() => setPhase({ name: 'amount' })}
                data-testid="pay-back"
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={() => void handleApprove()}
                data-testid="pay-approve"
              >
                Approve
              </button>
            </div>
          </div>
        )}

        {(phase.name === 'preparing' || phase.name === 'signing') && (
          <div className="pay-waiting" data-testid="pay-waiting">
            <div className="spinner" aria-hidden="true" />
            <p className="pay-waiting-copy">
              {phase.name === 'preparing'
                ? 'Preparing your payment...'
                : 'Sign the payment in Kastle...'}
            </p>
          </div>
        )}

        {phase.name === 'sent' && (
          <div className="pay-outcome" data-testid="pay-sent">
            <div className="status-icon status-icon-ok" aria-hidden="true">
              ✓
            </div>
            <h2 className="dialog-title">Payment approved — waiting for the record...</h2>
            <p className="dialog-copy">
              Your payment appears in the book the moment it's permanently recorded.
            </p>
            <button
              className="button button-primary button-full"
              onClick={handleRecorded}
              data-testid="pay-back-to-book"
            >
              Back to the book
            </button>
          </div>
        )}

        {phase.name === 'failed' && (
          <div className="pay-outcome" data-testid="pay-failed">
            <div className="status-icon status-icon-error" aria-hidden="true">
              ✗
            </div>
            <h2 className="dialog-title">Payment didn't go through</h2>
            <p className="dialog-copy">
              Your payment didn&rsquo;t go through. Nothing was paid and nothing is in the book.
            </p>
            <button
              className="button button-primary button-full"
              onClick={onClose}
              data-testid="pay-failed-close"
            >
              Close
            </button>
          </div>
        )}

        {phase.name === 'error' && (
          <div className="pay-outcome" data-testid="pay-error">
            <div className="status-icon status-icon-error" aria-hidden="true">
              ✗
            </div>
            <h2 className="dialog-title">Something went wrong</h2>
            <p className="dialog-copy">{phase.message}</p>
            <button
              className="button button-primary button-full"
              onClick={onClose}
              data-testid="pay-error-close"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
