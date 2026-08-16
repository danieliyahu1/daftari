import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackLink } from '../../src/components/BackLink'

describe('BackLink', () => {
  it('renders a link to the target with the label', () => {
    render(
      <MemoryRouter>
        <BackLink to="/" label="Your chamas" />
      </MemoryRouter>,
    )
    const link = screen.getByTestId('back-link')
    expect(link).toHaveAttribute('href', '/')
    expect(link).toHaveTextContent('Your chamas')
  })
})
