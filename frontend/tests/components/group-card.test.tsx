import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GroupCard } from '../../src/components/GroupCard'
import { CHAMA_ADDRESS } from '../helpers'

function renderCard(): void {
  render(
    <MemoryRouter>
      <ul>
        <GroupCard code={CHAMA_ADDRESS} name="Plot" />
      </ul>
    </MemoryRouter>,
  )
}

describe('GroupCard', () => {
  it('shows the chama name', () => {
    renderCard()
    expect(screen.getByText('Plot')).toBeInTheDocument()
  })

  it('links to the group book', () => {
    renderCard()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/groups/${encodeURIComponent(CHAMA_ADDRESS)}`,
    )
  })
})