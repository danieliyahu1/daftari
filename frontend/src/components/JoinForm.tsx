import { useState } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { logger } from '../logger'

interface JoinFormProps {
  userAddress: string
  onJoined: (code: string) => void
}

const INVALID_CODE_COPY = "That code isn't valid. Check it with your group and try again."

export function JoinForm({ userAddress, onJoined }: JoinFormProps): JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = code.trim()
    if (trimmed === '') {
      setError('Enter your group\u2019s code')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiClient.joinMembership({ user_address: userAddress, chama_address: trimmed })
      setCode('')
      logger.info('joined chama', { chamaAddress: trimmed })
      onJoined(trimmed)
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        (err.body as { outcome?: string } | undefined)?.outcome === 'invalid-code'
      ) {
        setError(INVALID_CODE_COPY)
      } else {
        const message = err instanceof ApiClientError ? err.message : 'Something went wrong. Try again.'
        logger.warn('join failed', { error: message })
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="join-form" onSubmit={handleSubmit} data-testid="join-form">
      <label className="join-form-label" htmlFor="join-code">
        Enter your group&rsquo;s code
      </label>
      <div className="join-form-row">
        <input
          id="join-code"
          className="input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Enter your group's code"
          aria-invalid={error !== null}
          disabled={busy}
          data-testid="join-code-input"
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || code.trim() === ''}
          data-testid="join-submit"
        >
          {busy ? 'Adding...' : 'Add a chama'}
        </button>
      </div>
      {error ? (
        <p className="field-error" role="alert" data-testid="join-error">
          {error}
        </p>
      ) : null}
    </form>
  )
}
