import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { GroupCard } from '../../src/components/GroupCard'
import { CHAMA_ADDRESS } from '../helpers'

function renderCard(onRemove: (code: string) => void = vi.fn()): void {
  render(
    <MemoryRouter>
      <ul>
        <GroupCard code={CHAMA_ADDRESS} createdAt={1_700_000_000_000} onRemove={onRemove} />
      </ul>
    </MemoryRouter>,
  )
}

describe('GroupCard', () => {
  it('shows the short address and the joined date', () => {
    renderCard()
    expect(screen.getByText('kaspatest:...rle5a7')).toBeInTheDocument()
    expect(screen.getByText(/Joined .+2023/)).toBeInTheDocument()
  })

  it('links to the group book', () => {
    renderCard()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/groups/${encodeURIComponent(CHAMA_ADDRESS)}`,
    )
  })

  it('reports removal with the full code', async () => {
    const onRemove = vi.fn()
    renderCard(onRemove)
    await userEvent.click(screen.getByRole('button', { name: 'Remove group' }))
    expect(onRemove).toHaveBeenCalledWith(CHAMA_ADDRESS)
  })
})
