import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../../src/components/ConfirmDialog'

const PROPS = {
  title: 'Remove this group?',
  message: 'Remove the group from your home screen?',
  confirmLabel: 'Remove',
}

describe('ConfirmDialog', () => {
  it('shows the title, message, and both actions', () => {
    render(<ConfirmDialog {...PROPS} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(PROPS.title)).toBeInTheDocument()
    expect(screen.getByText(PROPS.message)).toBeInTheDocument()
    expect(screen.getByTestId('confirm-cancel')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-confirm')).toBeInTheDocument()
  })

  it('confirms and cancels', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...PROPS} onConfirm={onConfirm} onCancel={onCancel} />)

    await userEvent.click(screen.getByTestId('confirm-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...PROPS} onConfirm={vi.fn()} onCancel={onCancel} />)

    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables the actions while busy', () => {
    render(<ConfirmDialog {...PROPS} busy onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('confirm-confirm')).toBeDisabled()
    expect(screen.getByTestId('confirm-cancel')).toBeDisabled()
  })
})
