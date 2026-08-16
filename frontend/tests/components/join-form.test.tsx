import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinForm } from '../../src/components/JoinForm'
import { CHAMA_ADDRESS, stubApi } from '../helpers'

describe('JoinForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the submit disabled until a code is entered', () => {
    render(<JoinForm userAddress="user" onJoined={vi.fn()} />)
    expect(screen.getByTestId('join-submit')).toBeDisabled()
  })

  it('joins with the entered code and reports the join', async () => {
    stubApi({ 'POST /api/memberships': { status: 201, body: { outcome: 'joined' } } })
    const onJoined = vi.fn()
    render(<JoinForm userAddress="user" onJoined={onJoined} />)

    await userEvent.type(screen.getByTestId('join-code-input'), CHAMA_ADDRESS)
    await userEvent.click(screen.getByTestId('join-submit'))

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(CHAMA_ADDRESS))
    expect(screen.getByTestId('join-code-input')).toHaveValue('')
  })

  it('shows the invalid-code copy when the backend rejects the code', async () => {
    stubApi({ 'POST /api/memberships': { status: 422, body: { outcome: 'invalid-code' } } })
    const onJoined = vi.fn()
    render(<JoinForm userAddress="user" onJoined={onJoined} />)

    await userEvent.type(screen.getByTestId('join-code-input'), 'not-a-code')
    await userEvent.click(screen.getByTestId('join-submit'))

    await waitFor(() =>
      expect(
        screen.getByText("That code isn't valid. Check it with your group and try again."),
      ).toBeInTheDocument(),
    )
    expect(onJoined).not.toHaveBeenCalled()
  })

  it('asks for a code when the field is submitted empty', async () => {
    render(<JoinForm userAddress="user" onJoined={vi.fn()} />)
    await userEvent.type(screen.getByTestId('join-code-input'), '   {enter}')
    expect(screen.getByText('Enter your group\u2019s code')).toBeInTheDocument()
  })
})
