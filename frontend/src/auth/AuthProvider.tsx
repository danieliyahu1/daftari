import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiClient, ApiClientError, setAuthToken } from '../api/client'
import { logger } from '../logger'
import { useWallet } from '../wallet/WalletProvider'

export type AuthStatus = 'idle' | 'signing-in' | 'ready' | 'error'

interface AuthState {
  status: AuthStatus
  error: string | null
  address: string | null
}

interface AuthActions {
  signIn: () => Promise<void>
}

export type Auth = AuthState & AuthActions

const DEFAULT_AUTH: Auth = {
  status: 'idle',
  error: null,
  address: null,
  signIn: async () => {},
}

const AuthContext = createContext<Auth>(DEFAULT_AUTH)

export function useAuth(): Auth {
  return useContext(AuthContext)
}

interface AuthProviderProps {
  children: ReactNode
}

async function signInFlow(address: string): Promise<void> {
  const { message } = await apiClient.createChallenge(address)
  if (!window.kastle) throw new Error('Kastle is not installed')
  const signature = await window.kastle.signMessage(message)
  const { token } = await apiClient.createSession(message, signature)
  setAuthToken(token)
  logger.info('authenticated', { address })
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const wallet = useWallet()
  const [status, setStatus] = useState<AuthStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)

  const signIn = useCallback(async () => {
    if (!wallet.address) return
    const target = wallet.address
    setStatus('signing-in')
    setError(null)
    try {
      await signInFlow(target)
      setAddress(target)
      setStatus('ready')
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Could not sign you in.'
      logger.warn('auth failed', { error: message })
      setError(message)
      setStatus('error')
    }
  }, [wallet.address])

  useEffect(() => {
    if (wallet.status !== 'connected' || !wallet.address) {
      setAuthToken(null)
      setStatus('idle')
      setAddress(null)
      setError(null)
      return
    }
    // Re-authenticate whenever the connected address changes.
    if (address !== wallet.address) {
      void signIn()
    }
  }, [wallet.status, wallet.address, address, signIn])

  const value = useMemo<Auth>(
    () => ({ status, error, address, signIn }),
    [status, error, address, signIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
