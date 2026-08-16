import { useCallback, useEffect, useState } from 'react'
import { getNetworkConfig } from '../../../shared/network'
import { CONNECT_TIMEOUT_MS } from '../constants'
import { logger } from '../logger'

export const EXPECTED_NETWORK = getNetworkConfig({
  KASPANET: import.meta.env.VITE_KASPANET as string | undefined,
}).networkId

export type KastleStatus =
  | 'idle'
  | 'not-installed'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'wrong-network'

export interface KastleState {
  status: KastleStatus
  address: string | null
  network: string | null
  error: string | null
}

export interface KastleExtension {
  connect: () => Promise<unknown>
  getAccount: () => Promise<{ address: string; publicKey?: string } | { address?: string; publicKey?: string }>
  getNetwork: () => Promise<string>
  switchNetwork: (networkId: string) => Promise<unknown>
  signTx: (
    networkId: string | undefined,
    txJson: string,
    scripts?: unknown,
  ) => Promise<string | { txJson?: string; signedTx?: string; tx?: string }>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    kastle?: KastleExtension
  }
}

export interface KastleActions {
  connect: () => Promise<void>
  switchToTestnet: () => Promise<void>
  disconnect: () => void
  clearError: () => void
}

const NETWORK_ALIASES: Record<string, string> = {
  mainnet: 'mainnet',
  kaspa_mainnet: 'mainnet',
  'testnet-10': 'testnet-10',
  kaspa_testnet_10: 'testnet-10',
  testnet_10: 'testnet-10',
  'testnet-11': 'testnet-11',
  kaspa_testnet_11: 'testnet-11',
  testnet_11: 'testnet-11',
}

function normalizeNetwork(raw: string | undefined): string | null {
  if (!raw) return null
  return NETWORK_ALIASES[raw] ?? raw
}

async function readNetwork(): Promise<string | null> {
  try {
    const network = await window.kastle?.getNetwork?.()
    return normalizeNetwork(network)
  } catch {
    return null
  }
}

export function extractSignedTx(
  result: string | { txJson?: string; signedTx?: string; tx?: string },
): string {
  if (typeof result === 'string') return result
  return result?.txJson ?? result?.signedTx ?? result?.tx ?? ''
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The request timed out. Try again.')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function isUserRejection(err: unknown): boolean {
  if (err instanceof Error) return /rejected|cancelled|canceled|denied|timeout/i.test(err.message)
  if (err && typeof err === 'object') {
    if ((err as { code?: unknown }).code === 4001) return true
    const message = (err as { message?: unknown }).message
    return typeof message === 'string' && /rejected|cancelled|canceled|denied/i.test(message)
  }
  return false
}

const INITIAL_STATE: KastleState = {
  status: 'idle',
  address: null,
  network: null,
  error: null,
}

export function useKastle(): KastleState & KastleActions {
  const [state, setState] = useState<KastleState>(() => ({
    ...INITIAL_STATE,
    status: window.kastle ? 'disconnected' : 'not-installed',
  }))
  const [installed, setInstalled] = useState<boolean>(() => !!window.kastle)

  const applyAccount = useCallback(async (address: string) => {
    const network = await readNetwork()
    setState((prev) =>
      network === EXPECTED_NETWORK
        ? { ...prev, status: 'connected', address, network, error: null }
        : { ...prev, status: 'wrong-network', address, network, error: null },
    )
    if (network === EXPECTED_NETWORK) {
      logger.info('wallet connected', { address, network })
    } else {
      logger.warn('wallet on unexpected network', { address, network, expected: EXPECTED_NETWORK })
    }
  }, [])

  useEffect(() => {
    if (installed) return
    let stopped = false
    const detect = () => {
      if (stopped) return
      if (window.kastle) {
        setInstalled(true)
        return
      }
      setState((prev) =>
        prev.status === 'not-installed' ? prev : { ...prev, status: 'not-installed' },
      )
    }
    detect()
    const pollTimer = setInterval(detect, 200)
    const stopTimer = setTimeout(() => clearInterval(pollTimer), 2000)
    const handleFocus = () => detect()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') detect()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stopped = true
      clearInterval(pollTimer)
      clearTimeout(stopTimer)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [installed])

  useEffect(() => {
    if (!installed) {
      setState((prev) => ({ ...prev, status: 'not-installed' }))
      return
    }
    const kastle = window.kastle
    if (!kastle) return
    setState((prev) => ({ ...prev, status: 'disconnected', error: null }))

    const handleAccountsChanged = (accounts: unknown) => {
      const addrs = accounts as string[]
      if (addrs.length === 0) {
        logger.info('kastle accounts changed: disconnected')
        setState((prev) => ({ ...prev, status: 'disconnected', address: null, network: null, error: null }))
      } else {
        const address = addrs[0]
        if (address) void applyAccount(address)
      }
    }
    const handleNetworkChanged = () => {
      setState((prev) => {
        if (prev.address) void applyAccount(prev.address)
        return prev
      })
    }

    kastle.on('accountsChanged', handleAccountsChanged)
    kastle.on('networkChanged', handleNetworkChanged)

    kastle
      .getAccount()
      .then((account) => {
        const address = account?.address
        if (address) void applyAccount(address)
      })
      .catch((err) => {
        logger.warn('kastle getAccount failed', { error: String(err) })
      })

    return () => {
      kastle.off?.('accountsChanged', handleAccountsChanged)
      kastle.off?.('networkChanged', handleNetworkChanged)
    }
  }, [installed, applyAccount])

  const connect = useCallback(async () => {
    if (!window.kastle) {
      setState((prev) => ({ ...prev, status: 'not-installed' }))
      return
    }
    setState((prev) => ({ ...prev, status: 'connecting', error: null }))
    try {
      await withTimeout(Promise.resolve(window.kastle.connect()), CONNECT_TIMEOUT_MS)
      const account = await withTimeout(window.kastle.getAccount(), CONNECT_TIMEOUT_MS)
      const address = account?.address
      if (!address) {
        setState((prev) => ({ ...prev, status: 'disconnected', error: 'Connection cancelled.' }))
        return
      }
      await applyAccount(address)
    } catch (err) {
      const message = isUserRejection(err)
        ? 'Connection cancelled.'
        : "Couldn't connect your wallet."
      logger.error('kastle connection failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      setState((prev) => ({ ...prev, status: 'disconnected', error: message }))
    }
  }, [applyAccount])

  const switchToTestnet = useCallback(async () => {
    if (!window.kastle || !state.address) return
    setState((prev) => ({ ...prev, error: null }))
    try {
      await window.kastle.switchNetwork(EXPECTED_NETWORK)
      const network = await readNetwork()
      setState((prev) =>
        network === EXPECTED_NETWORK
          ? { ...prev, status: 'connected', network, error: null }
          : { ...prev, status: 'wrong-network', network, error: null },
      )
      if (network === EXPECTED_NETWORK) {
        logger.info('network switched', { network })
      } else {
        logger.warn('network switch did not reach expected network', { network, expected: EXPECTED_NETWORK })
      }
    } catch (err) {
      const message = isUserRejection(err)
        ? 'Network switch declined.'
        : 'Kastle would not switch networks.'
      setState((prev) => ({ ...prev, status: 'wrong-network', error: message }))
    }
  }, [state.address])

  const disconnect = useCallback(() => {
    logger.info('wallet disconnected')
    setState((prev) => ({ ...prev, status: 'disconnected', address: null, network: null, error: null }))
  }, [])

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  return {
    ...state,
    connect,
    switchToTestnet,
    disconnect,
    clearError,
  }
}
