import { Component, useEffect } from 'react'
import { logger } from '../logger'
import { useToast } from './Toaster'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

function BoundaryToast({ message }: { message: string }): React.ReactNode {
  const { showToast } = useToast()

  useEffect(() => {
    showToast({ message, kind: 'error' })
  }, [message, showToast])

  return null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error('react error boundary caught', {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div role="alert" className="error-container">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
          <button
            className="button button-secondary"
            onClick={() => {
              logger.info('error boundary reset')
              this.setState({ hasError: false, error: null })
            }}
          >
            Try again
          </button>
          <BoundaryToast message="Something went wrong." />
        </div>
      )
    }

    return this.props.children
  }
}
