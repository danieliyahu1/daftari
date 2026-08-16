import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { TOAST_DURATION_MS, TOAST_EXIT_MS, ToastProvider, useToast } from '../../src/components/Toaster'

function ShowButton({ message }: { message: string }): JSX.Element {
  const { showToast } = useToast()
  return (
    <button type="button" onClick={() => showToast({ message })}>
      show
    </button>
  )
}

describe('useToast', () => {
  it('throws when used outside a ToastProvider', () => {
    expect(() => renderHook(() => useToast())).toThrow(
      'useToast must be used within a ToastProvider',
    )
  })
})

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a toast on demand', () => {
    render(
      <ToastProvider>
        <ShowButton message="hello" />
      </ToastProvider>,
    )
    expect(screen.queryByText('hello')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('show'))

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('auto-dismisses a toast after its duration', () => {
    render(
      <ToastProvider>
        <ShowButton message="hello" />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    expect(screen.getByText('hello')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    act(() => vi.advanceTimersByTime(TOAST_EXIT_MS + 10))

    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })
})
