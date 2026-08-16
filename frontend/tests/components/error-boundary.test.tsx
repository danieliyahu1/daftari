import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { ToastProvider } from '../../src/components/Toaster'

function Bomb({ fail }: { fail: boolean }): JSX.Element {
  if (fail) throw new Error('boom')
  return <p>fine</p>
}

function TestApp(): JSX.Element {
  const [fail, setFail] = useState(true)
  return (
    <div>
      <button type="button" onClick={() => setFail(false)}>
        fix
      </button>
      <ErrorBoundary>
        <Bomb fail={fail} />
      </ErrorBoundary>
    </div>
  )
}

describe('ErrorBoundary', () => {
  it('renders the fallback when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ToastProvider>
        <ErrorBoundary>
          <Bomb fail={true} />
        </ErrorBoundary>
      </ToastProvider>,
    )
    consoleError.mockRestore()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('re-renders the children after Try again once the error is gone', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ToastProvider>
        <TestApp />
      </ToastProvider>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    consoleError.mockRestore()

    await userEvent.click(screen.getByText('fix'))
    await userEvent.click(screen.getByText('Try again'))

    expect(screen.getByText('fine')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})
