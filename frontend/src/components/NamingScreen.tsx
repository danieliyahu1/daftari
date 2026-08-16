import { useState } from 'react'
import type { WalletKind } from '../../../shared/types'
import { logger } from '../logger'
import { useRegistry } from '../wallet/registry'

const NAME_LABEL = 'Give this wallet a name.'
const KIND_QUESTION = 'Is this wallet yours, or a group\u2019s?'
const KIND_OPTIONS: Array<{ value: WalletKind; label: string }> = [
  { value: 'user', label: 'This is me' },
  { value: 'group', label: 'This is a group' },
]
const NAME_ERROR_COPY = 'Names are between 2 and 20 characters.'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function isValidName(raw: string): boolean {
  const name = raw.trim()
  return name.length >= 2 && name.length <= 20 && !CONTROL_CHARACTERS.test(name)
}

export function NamingScreen(): JSX.Element {
  const registry = useRegistry()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<WalletKind | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (registry.status === 'naming-success' && registry.identity !== null) {
    return (
      <div className="naming-screen" data-testid="naming-success">
        <div className="naming-card">
          <p className="naming-success-copy" data-testid="naming-success-copy">
            You&rsquo;re all set, {registry.identity.name}.
          </p>
        </div>
      </div>
    )
  }

  const canContinue = kind !== null && !busy

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (kind === null || busy) return
    setSubmitError(null)
    if (!isValidName(name)) {
      setNameError(NAME_ERROR_COPY)
      return
    }
    setNameError(null)
    setBusy(true)
    try {
      await registry.register(name.trim(), kind)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Try again.'
      logger.warn('naming failed', { error: message })
      setSubmitError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="naming-screen" data-testid="naming-screen">
      <div className="naming-card">
        <form onSubmit={handleSubmit}>
          <label className="naming-label" htmlFor="wallet-name">
            {NAME_LABEL}
          </label>
          <input
            id="wallet-name"
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (nameError !== null) setNameError(null)
            }}
            disabled={busy}
            aria-invalid={nameError !== null}
            autoFocus
            data-testid="naming-name-input"
          />
          {nameError ? (
            <p className="field-error" role="alert" data-testid="naming-name-error">
              {nameError}
            </p>
          ) : null}

          <p className="naming-label" id="wallet-kind-label">
            {KIND_QUESTION}
          </p>
          <div
            className="kind-options"
            role="radiogroup"
            aria-labelledby="wallet-kind-label"
            data-testid="kind-options"
          >
            {KIND_OPTIONS.map((option) => {
              const selected = kind === option.value
              return (
                <button
                  type="button"
                  key={option.value}
                  role="radio"
                  aria-checked={selected}
                  className={`kind-option${selected ? ' kind-option--selected' : ''}`}
                  onClick={() => setKind(option.value)}
                  disabled={busy}
                  data-testid={`kind-option-${option.value}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {submitError ? (
            <p className="field-error" role="alert" data-testid="naming-error">
              {submitError}
            </p>
          ) : null}

          <button
            type="submit"
            className="button button-primary button-full"
            disabled={!canContinue}
            data-testid="naming-submit"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  )
}