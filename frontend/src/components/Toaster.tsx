import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ToastKind = 'error' | 'info'

interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastInput {
  message: string
  kind?: ToastKind
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export const TOAST_DURATION_MS = 3000
export const TOAST_EXIT_MS = 250

let nextToastId = 0

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: number) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps): JSX.Element {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => setLeaving(true), TOAST_DURATION_MS)
    return () => clearTimeout(exitTimer)
  }, [])

  useEffect(() => {
    if (!leaving) return
    const removeTimer = setTimeout(() => onDismiss(toast.id), TOAST_EXIT_MS)
    return () => clearTimeout(removeTimer)
  }, [leaving, onDismiss, toast.id])

  return (
    <div
      className={`toast toast--${toast.kind}${leaving ? ' toast--leaving' : ''}`}
      data-testid={`toast-${toast.kind}`}
    >
      {toast.message}
    </div>
  )
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(({ message, kind = 'info' }: ToastInput) => {
    const id = nextToastId++
    setToasts((prev) => [...prev, { id, message, kind }])
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
