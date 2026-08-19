import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Wallet, WalletKind } from '../../../shared/types'
import { apiClient, ApiClientError } from '../api/client'
import { logger } from '../logger'
import { useWallet } from './WalletProvider'

export type RegistryStatus = 'checking' | 'unnamed' | 'naming-success' | 'named' | 'error'

interface RegistryState {
  status: RegistryStatus
  identity: Wallet | null
  error: string | null
}

interface RegistryActions {
  register: (name: string, kind: WalletKind) => Promise<void>
  retry: () => void
}

export type Registry = RegistryState & RegistryActions

const SUCCESS_DELAY_MS = 1_400

const DEFAULT_REGISTRY: Registry = {
  status: 'named',
  identity: null,
  error: null,
  register: async () => {},
  retry: () => {},
}

const RegistryContext = createContext<Registry>(DEFAULT_REGISTRY)

export function useRegistry(): Registry {
  return useContext(RegistryContext)
}

interface RegistryProviderProps {
  children: ReactNode
}

export function RegistryProvider({ children }: RegistryProviderProps): JSX.Element {
  const wallet = useWallet()
  const [state, setState] = useState<RegistryState>({ status: 'checking', identity: null, error: null })
  const successTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (successTimer.current !== undefined) window.clearTimeout(successTimer.current)
    }
  }, [])

  const resolveOwn = useCallback(async () => {
    if (wallet.status !== 'connected' || !wallet.address) {
      if (successTimer.current !== undefined) {
        window.clearTimeout(successTimer.current)
        successTimer.current = undefined
      }
      setState({ status: 'checking', identity: null, error: null })
      return
    }
    setState((prev) => ({ ...prev, status: 'checking', error: null }))
    try {
      const { wallets } = await apiClient.resolveWallets([wallet.address])
      const identity = wallets.find((w) => w.address === wallet.address) ?? null
      if (identity !== null) {
        setState({ status: 'named', identity, error: null })
      } else {
        setState({ status: 'unnamed', identity: null, error: null })
      }
      logger.info('own wallet resolved', { named: identity !== null })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Could not check your wallet.'
      logger.warn('failed to resolve own wallet', { error: message })
      setState({ status: 'error', identity: null, error: message })
    }
  }, [wallet.status, wallet.address])

  useEffect(() => {
    void resolveOwn()
  }, [resolveOwn])

  const register = useCallback(
    async (name: string, kind: WalletKind) => {
      const { wallet: identity } = await apiClient.registerWallet({
        name,
        kind,
      })
      setState({ status: 'naming-success', identity, error: null })
      if (successTimer.current !== undefined) window.clearTimeout(successTimer.current)
      successTimer.current = window.setTimeout(() => {
        setState({ status: 'named', identity, error: null })
        successTimer.current = undefined
      }, SUCCESS_DELAY_MS)
    },
    [],
  )

  const retry = useCallback(() => {
    void resolveOwn()
  }, [resolveOwn])

  const value = useMemo<Registry>(() => ({ ...state, register, retry }), [state, register, retry])

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>
}