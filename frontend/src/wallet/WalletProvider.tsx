import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useKastle, type KastleActions, type KastleState } from './kastle'

export type Wallet = KastleState & KastleActions

const WalletContext = createContext<Wallet | null>(null)

export function useWallet(): Wallet {
  const context = useContext(WalletContext)
  if (!context) throw new Error('useWallet must be used within a WalletProvider')
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps): JSX.Element {
  const wallet = useKastle()
  const value = useMemo(() => wallet, [wallet])
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
