import { ApiClientError, createApiClient } from '../../src/api/client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the home for the connected address', async () => {
    const home = { identity: null, members: [], chamas: [] }
    global.fetch = vi.fn(async () => jsonResponse(200, home))

    const result = await createApiClient().getHome('kaspatest:abc')

    expect(result).toEqual(home)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships?user=kaspatest%3Aabc',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('adds a member with a POST and the addresses in the body', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(201, {
        membership: { user_address: 'member', chama_address: 'chama', created_at: 1 },
      }),
    )

    await createApiClient().addMember({
      group_address: 'chama',
      member_address: 'member',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ group_address: 'chama', member_address: 'member' }),
      }),
    )
  })

  it('reads the book with encoded code, pagination query, and requester', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, { balance_sompi: '0', rows: [], group: { address: 'chama', name: 'Plot', kind: 'group' } }),
    )

    await createApiClient().getBook('kaspatest:abc', 50, 100, 'kaspatest:me')

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chamas/kaspatest%3Aabc/book?limit=50&offset=100&user=kaspatest%3Ame',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reads the book without a requester when none is connected', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, { balance_sompi: '0', rows: [], group: { address: 'chama', name: 'Plot', kind: 'group' } }),
    )

    await createApiClient().getBook('kaspatest:abc', 50, 0)

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chamas/kaspatest%3Aabc/book?limit=50&offset=0',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('prepends a base url when provided', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { ok: true }))

    await createApiClient('http://localhost:4100/api').getBook('kaspatest:abc', 50, 0)

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4100/api/chamas/kaspatest%3Aabc/book?limit=50&offset=0',
      expect.anything(),
    )
  })

  it('extracts the message from a nested error body', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(422, { error: { kind: 'invalid', message: 'That code is not valid' } }),
    )

    const promise = createApiClient().addMember({
      group_address: 'chama',
      member_address: 'bad',
    })
    const error = await promise.catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiClientError)
    const apiError = error as ApiClientError
    expect(apiError.status).toBe(422)
    expect(apiError.message).toBe('That code is not valid')
    expect(apiError.body).toEqual({ error: { kind: 'invalid', message: 'That code is not valid' } })
  })

  it('extracts a flat error message', async () => {
    global.fetch = vi.fn(async () => jsonResponse(503, { message: 'Upstream unavailable' }))

    const error = (await createApiClient()
      .getHome('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(503)
    expect(error.message).toBe('Upstream unavailable')
  })

  it('falls back to the status text for a non-JSON error body', async () => {
    global.fetch = vi.fn(async () => new Response('oops', { status: 500 }))

    const error = (await createApiClient()
      .getHome('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(500)
    expect(error.message).toBe('Request failed with status 500')
  })

  it('surfaces a request timeout as a status-0 network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const error = (await createApiClient()
      .getHome('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/timed out/)
  })

  it('surfaces a network failure as a status-0 network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = (await createApiClient()
      .getHome('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Network error/)
  })
})