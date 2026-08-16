import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InviteDialog } from '../../src/components/InviteDialog'
import { CHAMA_ADDRESS } from '../helpers'

function renderDialog(): void {
  render(<InviteDialog groupCode={CHAMA_ADDRESS} onClose={vi.fn()} />)
}

describe('InviteDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a contribution link containing the group', () => {
    renderDialog()
    const link = screen.getByTestId('invite-link') as HTMLInputElement
    expect(link.value).toBe(
      `${window.location.origin}/contribute/${encodeURIComponent(CHAMA_ADDRESS)}`,
    )
  })

  it('copies the link and confirms', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderDialog()
    await userEvent.click(screen.getByTestId('invite-copy'))
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/contribute/${encodeURIComponent(CHAMA_ADDRESS)}`,
    )
    expect(screen.getByTestId('invite-copy')).toHaveTextContent('Copied')
  })

  it('closes on demand', async () => {
    const onClose = vi.fn()
    render(<InviteDialog groupCode={CHAMA_ADDRESS} onClose={onClose} />)
    await userEvent.click(screen.getByTestId('invite-close'))
    expect(onClose).toHaveBeenCalled()
  })
})