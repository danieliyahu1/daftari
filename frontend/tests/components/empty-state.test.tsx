import { render, screen } from '@testing-library/react'
import { EmptyState } from '../../src/components/EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nothing here yet" />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Nothing here yet')
  })

  it('renders children', () => {
    render(
      <EmptyState title="Nothing here yet">
        <p>an action</p>
      </EmptyState>,
    )
    expect(screen.getByText('an action')).toBeInTheDocument()
  })
})
